{
  buildGoModule,
  ghostscript_headless,
  texlive,
}:
let
  tex = texlive.withPackages (
    ps: with ps; [
      scheme-small
      latex
      latex-bin
      luatex
      luaotfload
      luatex85
      lm
      amsmath
      amsfonts
      xcolor
      latexmk
      epstopdf-pkg
      pgf
      pgfplots
      standalone
      pict2e
      geometry
    ]
  );
in
buildGoModule {
  pname = "renderer";
  version = "0.1.0";
  src = ../renderer;
  vendorHash = null;

  env.CGO_ENABLED = 0;

  ldflags = [
    "-s"
    "-w"
    "-X main.lualatexPath=${tex}/bin/lualatex"
    "-X main.gsPath=${ghostscript_headless}/bin/gs"
  ];

  meta = {
    description = "Renders a LaTeX document from stdin to a PNG on stdout";
    mainProgram = "render";
    platforms = [ "x86_64-linux" ];
  };
}
