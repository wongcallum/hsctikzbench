{
  dockerTools,
  renderer,
  tini,
}:
dockerTools.buildLayeredImage {
  name = "ghcr.io/wongcallum/hsctikzbench-renderer";
  # keep in sync with DEFAULT_IMAGE in cli/src/renderer.ts
  tag = "0.2.0";
  contents = [
    renderer
    tini
  ];
  extraCommands = ''
    mkdir -p tmp
    chmod 1777 tmp
  '';
  config = {
    User = "1000:1000";
    WorkingDir = "/tmp";
    Env = [
      "PATH=/bin"
      "HOME=/tmp"
      "TMPDIR=/tmp"
    ];
    Entrypoint = [
      "tini"
      "--"
    ];
    Cmd = [ "render" ];
  };
}
