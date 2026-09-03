{
  description = "HSCTikZBench";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      renderer = pkgs.callPackage ./nix/renderer.nix { };
      image = pkgs.callPackage ./nix/image.nix { inherit renderer; };
    in
    {
      packages.${system} = {
        inherit renderer image;
      };
    };
}
