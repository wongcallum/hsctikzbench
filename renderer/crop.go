package main

import (
	"bytes"
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"io"
	"math"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// coordinates are fractions of page w/h, origin from top left
type rect struct{ x, y, w, h float64 }

// a box touching the right or bottom of the page edge may sum to fractionally more than one
const rectTolerance = 1.000001

func parseRect(s string) (rect, error) {
	parts := strings.Split(s, ",")
	if len(parts) != 4 {
		return rect{}, fmt.Errorf("want x,y,w,h, got %q", s)
	}
	var v [4]float64
	for i, p := range parts {
		f, err := strconv.ParseFloat(strings.TrimSpace(p), 64)
		if err != nil {
			return rect{}, fmt.Errorf("bad number in %q: %v", s, err)
		}
		v[i] = f
	}
	r := rect{v[0], v[1], v[2], v[3]}
	if r.x < 0 || r.y < 0 || r.w <= 0 || r.h <= 0 || r.x+r.w > rectTolerance || r.y+r.h > rectTolerance {
		return rect{}, fmt.Errorf("rect %q must lie within the page with positive size", s)
	}
	return r, nil
}

func (r rect) pixels(page image.Rectangle) image.Rectangle {
	pw, ph := float64(page.Dx()), float64(page.Dy())
	return image.Rect(
		int(math.Floor(r.x*pw)),
		int(math.Floor(r.y*ph)),
		int(math.Ceil((r.x+r.w)*pw)),
		int(math.Ceil((r.y+r.h)*ph)),
	).Intersect(page)
}

type rectList []rect

func (l *rectList) String() string { return fmt.Sprint(*l) }

func (l *rectList) Set(s string) error {
	r, err := parseRect(s)
	if err != nil {
		return err
	}
	*l = append(*l, r)
	return nil
}

var pageCountRe = regexp.MustCompile(`File has (\d+) pages`)

func crop(args []string, stdin io.Reader, stdout, stderr io.Writer) error {
	fs := flag.NewFlagSet("crop", flag.ContinueOnError)
	fs.SetOutput(stderr)
	page := fs.Int("page", 0, "1-based page number")
	boxArg := fs.String("box", "", "region to keep as x,y,w,h fractions of the page")
	var masks rectList
	fs.Var(&masks, "mask", "region to paint white, repeatable")
	if err := fs.Parse(args); err != nil {
		return fail(exitSpec, "%v", err)
	}
	if fs.NArg() > 0 {
		return fail(exitSpec, "unexpected argument %q", fs.Arg(0))
	}
	if *page < 1 {
		return fail(exitSpec, "--page must be at least 1")
	}
	if *boxArg == "" {
		return fail(exitSpec, "--box is required")
	}
	box, err := parseRect(*boxArg)
	if err != nil {
		return fail(exitSpec, "--box: %v", err)
	}

	w, err := newWorkspace("crop-", stderr)
	if err != nil {
		return err
	}
	defer w.close()

	pdf, err := io.ReadAll(stdin)
	if err != nil {
		return err
	}
	if err := os.WriteFile(w.path("doc.pdf"), pdf, 0o644); err != nil {
		return err
	}

	info, err := w.pdfInfo("doc.pdf")
	if err != nil {
		return err
	}
	m := pageCountRe.FindSubmatch(info)
	if m == nil {
		stderr.Write(info)
		return fail(exitRaster, "could not determine page count")
	}
	pages, _ := strconv.Atoi(string(m[1]))
	if *page > pages {
		return fail(exitSpec, "--page %d is beyond the last page (%d)", *page, pages)
	}

	raw, err := w.rasterize("doc.pdf", *page, dpi)
	if err != nil {
		return err
	}
	src, err := png.Decode(bytes.NewReader(raw))
	if err != nil {
		return fail(exitRaster, "could not decode page raster: %v", err)
	}

	bounds := box.pixels(src.Bounds())
	if bounds.Empty() {
		return fail(exitSpec, "--box covers no pixels on page %d", *page)
	}
	out := image.NewRGBA(image.Rect(0, 0, bounds.Dx(), bounds.Dy()))
	draw.Draw(out, out.Bounds(), src, bounds.Min, draw.Src)
	for _, mask := range masks {
		visible := mask.pixels(src.Bounds()).Intersect(bounds).Sub(bounds.Min)
		draw.Draw(out, visible, image.NewUniform(color.White), image.Point{}, draw.Src)
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, out); err != nil {
		return err
	}
	_, err = stdout.Write(buf.Bytes())
	return err
}
