package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
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
	exitSpec     = 6
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
	fitRe      = regexp.MustCompile(`^(\d+)x(\d+)$`)
)

func main() {
	name, args := "render", os.Args[1:]
	if len(args) > 0 && (args[0] == "render" || args[0] == "crop") {
		name, args = args[0], args[1:]
	}

	var err error
	switch name {
	case "render":
		err = render(args, os.Stdin, os.Stdout, os.Stderr)
	case "crop":
		err = crop(args, os.Stdin, os.Stdout, os.Stderr)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s: %v\n", name, err)
		var f *failure
		if errors.As(err, &f) {
			os.Exit(f.code)
		}
		os.Exit(exitInternal)
	}
}

type workspace struct {
	dir    string
	ctx    context.Context
	cancel context.CancelFunc
	stderr io.Writer
}

func newWorkspace(prefix string, stderr io.Writer) (*workspace, error) {
	dir, err := os.MkdirTemp("", prefix)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	return &workspace{dir, ctx, cancel, stderr}, nil
}

func (w *workspace) close() {
	w.cancel()
	os.RemoveAll(w.dir)
}

func (w *workspace) path(name string) string { return filepath.Join(w.dir, name) }

func (w *workspace) step(code int, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(w.ctx, name, args...)
	cmd.Dir = w.dir
	cmd.Env = []string{"HOME=" + w.dir}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	cmd.WaitDelay = 5 * time.Second
	out, err := cmd.CombinedOutput()
	if err != nil {
		w.stderr.Write(out)
		if w.ctx.Err() != nil {
			return nil, fail(exitTimeout, "timed out after %v", timeout)
		}
		return nil, fail(code, "%s failed: %v", filepath.Base(name), err)
	}
	return out, nil
}

func (w *workspace) pdfInfo(pdf string) ([]byte, error) {
	return w.step(exitRaster, gsPath,
		"-q", "-dNODISPLAY", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-dPDFINFO", pdf)
}

func (w *workspace) rasterize(pdf string, page int, resolution float64) ([]byte, error) {
	if _, err := w.step(exitRaster, gsPath,
		"-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=png16m",
		fmt.Sprintf("-r%g", resolution), "-dTextAlphaBits=4", "-dGraphicsAlphaBits=4",
		fmt.Sprintf("-dFirstPage=%d", page), fmt.Sprintf("-dLastPage=%d", page),
		"-sOutputFile=page.png", pdf); err != nil {
		return nil, err
	}
	png, err := os.ReadFile(w.path("page.png"))
	if err != nil {
		return nil, fail(exitRaster, "gs produced no PNG")
	}
	return png, nil
}

func parseFit(s string) (float64, float64, error) {
	if s == "" {
		return 0, 0, nil
	}
	m := fitRe.FindStringSubmatch(s)
	if m == nil {
		return 0, 0, fmt.Errorf("want WxH in pixels, got %q", s)
	}
	fw, _ := strconv.Atoi(m[1])
	fh, _ := strconv.Atoi(m[2])
	if fw < 1 || fh < 1 {
		return 0, 0, fmt.Errorf("both sides must be at least 1, got %q", s)
	}
	return float64(fw), float64(fh), nil
}

func render(args []string, stdin io.Reader, stdout, stderr io.Writer) error {
	fs := flag.NewFlagSet("render", flag.ContinueOnError)
	fs.SetOutput(stderr)
	fitArg := fs.String("fit", "", "scale the raster down to fit within WxH pixels")
	if err := fs.Parse(args); err != nil {
		return fail(exitSpec, "%v", err)
	}
	if fs.NArg() > 0 {
		return fail(exitSpec, "unexpected argument %q", fs.Arg(0))
	}
	fitW, fitH, err := parseFit(*fitArg)
	if err != nil {
		return fail(exitSpec, "--fit: %v", err)
	}

	w, err := newWorkspace("render-", stderr)
	if err != nil {
		return err
	}
	defer w.close()

	tex, err := io.ReadAll(stdin)
	if err != nil {
		return err
	}
	if err := os.WriteFile(w.path("doc.tex"), tex, 0o644); err != nil {
		return err
	}

	_, latexErr := w.step(exitCompile, lualatexPath, "-interaction=batchmode", "-halt-on-error", "-no-shell-escape", "doc.tex")
	log, _ := os.ReadFile(w.path("doc.log"))
	stderr.Write(log)
	if latexErr != nil {
		return latexErr
	}
	m := pagesRe.FindSubmatch(log)
	if m == nil {
		return fail(exitCompile, "lualatex produced no PDF")
	}
	if string(m[1]) != "1" {
		return fail(exitTooLarge, "document has %s pages, expected exactly 1; keep all content in a single tikzpicture", m[1])
	}

	info, err := w.pdfInfo("doc.pdf")
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
	pw, ph := (x1-x0)*dpi/72, (y1-y0)*dpi/72
	if pw > maxPixels || ph > maxPixels {
		return fail(exitTooLarge, "page would be %.0fx%.0fpx, limit is %dpx per side; the page is measured at 300 dpi, use smaller coordinates or a smaller unit", pw, ph, maxPixels)
	}

	scale := 1.0
	if fitW > 0 {
		scale = math.Min(1, math.Min(fitW/pw, fitH/ph))
		// gs cannot write a raster with a zero-length side
		scale = math.Max(scale, math.Max(1/pw, 1/ph))
	}

	png, err := w.rasterize("doc.pdf", 1, dpi*scale)
	if err != nil {
		return err
	}
	_, err = stdout.Write(png)
	return err
}
