{
  lib,
  stdenv,
  fetchPnpmDeps,
  pnpmConfigHook,
  pnpm_11,
  nodejs_24,
  makeWrapper,
}:
let
  pnpm = pnpm_11;
  nodejs = nodejs_24;
  root = ../.;
  src = lib.fileset.toSource {
    inherit root;
    fileset = lib.fileset.difference (lib.fileset.gitTracked root) (
      lib.fileset.unions [
        (root + /nix)
        (root + /flake.nix)
        (root + /flake.lock)
        (root + /renderer)
        (root + /README.md)
        (root + /.gitignore)
        (root + /.oxfmtrc.json)
        (root + /.oxlintrc.json)
      ]
    );
  };
  packageJson = lib.importJSON (root + /web/package.json);
in
stdenv.mkDerivation (finalAttrs: {
  pname = "hsctikzbench";
  inherit (packageJson) version;
  inherit src;

  nativeBuildInputs = [
    nodejs
    pnpm
    pnpmConfigHook
    makeWrapper
  ];

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    inherit pnpm;
    fetcherVersion = 4;
    hash = "sha256-8E/yiTqeSYHARBu+quwD90wDzjVabKXYJJ5pFTNKeOY=";
  };

  buildPhase = ''
    runHook preBuild
    pnpm build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    lib=$out/lib/hsctikzbench
    mkdir -p $lib/cli $lib/web $lib/dataset $out/bin
    cp -r cli/dist cli/prompt.md $lib/cli/
    cp -r web/dist $lib/web/
    cp dataset/manifest.json $lib/dataset/
    makeWrapper ${lib.getExe nodejs} $out/bin/hsctikzbench \
      --add-flags $lib/cli/dist/cli.mjs
    makeWrapper ${lib.getExe nodejs} $out/bin/hsctikzbench-web \
      --add-flags $lib/web/dist/server.mjs \
      --set-default NODE_ENV production
    runHook postInstall
  '';

  meta = {
    description = "HSCTikZBench CLI web UI";
  };
})
