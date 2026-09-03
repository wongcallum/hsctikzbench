{
  dockerTools,
  renderer,
  tini,
}:
dockerTools.buildLayeredImage {
  name = "hsctikzbench-renderer";
  tag = null;
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
    Cmd = [
      "tini"
      "--"
      "render"
      "idle"
    ];
  };
}
