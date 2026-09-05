{
  buildGoModule,
  ghostscript_headless,
  texlive,
}:
let
  tex = texlive.withPackages (
    ps: with ps; [
      scheme-basic # latex, amsmath, luatex
      luaotfload
      lm # default font
      pgf
      pgfplots
      standalone
      luatex85 # required by standalone.cls
      fontspec
      unicode-math
      lualatex-math
      tex-gyre
      tex-gyre-math
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
    description = "Renders LaTeX documents and crops PDFs to PNGs";
    mainProgram = "render";
    platforms = [ "x86_64-linux" ];
  };
}
