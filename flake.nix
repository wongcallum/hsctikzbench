{
  description = "HSCTikZBench";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (
        pkgs:
        let
          renderer = pkgs.callPackage ./nix/renderer.nix { };
          hsctikzbench = pkgs.callPackage ./nix/hsctikzbench.nix { };
        in
        {
          inherit renderer hsctikzbench;
          default = renderer;
        }
        # the image holds Linux binaries, so only a Linux builder can produce it
        // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
          image = pkgs.callPackage ./nix/image.nix { inherit renderer; };
        }
      );
    };
}
