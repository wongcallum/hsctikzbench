package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"syscall"
	"time"
)

const (
	dpi       = 300
	timeout   = 60 * time.Second
	maxPixels = 8000
)

// Overridden at build time with ldflags
var (
	lualatexPath = "lualatex"
	gsPath       = "gs"
)

const (
	exitInternal = 1
	exitCompile  = 2
	exitTimeout  = 3
	exitTooLarge = 4
	exitRaster   = 5
)

type failure struct {
	code int
	msg  string
}

func (f *failure) Error() string { return f.msg }

func fail(code int, format string, args ...any) error {
	return &failure{code, fmt.Sprintf(format, args...)}
}

var (
	pagesRe    = regexp.MustCompile(`Output written on doc\.pdf \((\d+) page`)
	mediaBoxRe = regexp.MustCompile(`Page 1 MediaBox: \[([^\]]*)\]`)
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "idle" {
		stop := make(chan os.Signal, 1)
		signal.Notify(stop, syscall.SIGTERM, syscall.SIGINT)
		<-stop
		return
	}
	if err := run(os.Stdin, os.Stdout, os.Stderr); err != nil {
		fmt.Fprintf(os.Stderr, "render: %v\n", err)
		var f *failure
		if errors.As(err, &f) {
			os.Exit(f.code)
		}
		os.Exit(exitInternal)
	}
}

func run(stdin io.Reader, stdout, stderr io.Writer) error {
	work, err := os.MkdirTemp("", "render-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(work)

	tex, err := io.ReadAll(stdin)
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(work, "doc.tex"), tex, 0o644); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	step := func(code int, name string, args ...string) ([]byte, error) {
		cmd := exec.CommandContext(ctx, name, args...)
		cmd.Dir = work
		cmd.Env = []string{"HOME=" + work}
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
		cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
		cmd.WaitDelay = 5 * time.Second
		out, err := cmd.CombinedOutput()
		if err != nil {
			stderr.Write(out)
			if ctx.Err() != nil {
				return nil, fail(exitTimeout, "timed out after %v", timeout)
			}
			return nil, fail(code, "%s failed: %v", filepath.Base(name), err)
		}
		return out, nil
	}

	_, latexErr := step(exitCompile, lualatexPath, "-interaction=batchmode", "-halt-on-error", "-no-shell-escape", "doc.tex")
	log, _ := os.ReadFile(filepath.Join(work, "doc.log"))
	stderr.Write(log)
	if latexErr != nil {
		return latexErr
	}
	m := pagesRe.FindSubmatch(log)
	if m == nil {
		return fail(exitCompile, "lualatex produced no PDF")
	}
	if string(m[1]) != "1" {
		return fail(exitTooLarge, "document has %s pages, expected exactly 1", m[1])
	}

	info, err := step(exitRaster, gsPath,
		"-q", "-dNODISPLAY", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-dPDFINFO", "doc.pdf")
	if err != nil {
		return err
	}
	var x0, y0, x1, y1 float64
	if m = mediaBoxRe.FindSubmatch(info); m == nil {
		stderr.Write(info)
		return fail(exitRaster, "could not determine page size")
	}
	if _, err := fmt.Sscan(string(m[1]), &x0, &y0, &x1, &y1); err != nil {
		stderr.Write(info)
		return fail(exitRaster, "could not parse page size: %v", err)
	}
	w, h := (x1-x0)*dpi/72, (y1-y0)*dpi/72
	if w > maxPixels || h > maxPixels {
		return fail(exitTooLarge, "page would be %.0fx%.0fpx, limit is %dpx per side", w, h, maxPixels)
	}

	if _, err := step(exitRaster, gsPath,
		"-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=png16m",
		fmt.Sprintf("-r%d", dpi), "-dTextAlphaBits=4", "-dGraphicsAlphaBits=4",
		"-sOutputFile=doc.png", "doc.pdf"); err != nil {
		return err
	}
	png, err := os.ReadFile(filepath.Join(work, "doc.png"))
	if err != nil {
		return fail(exitRaster, "gs produced no PNG")
	}
	_, err = stdout.Write(png)
	return err
}
