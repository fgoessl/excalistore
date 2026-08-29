{
  description = "ExcaliStore development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            # Rust (api/)
            rustc
            cargo
            rust-analyzer
            clippy
            rustfmt
            sqlx-cli

            # native deps some crates in the sqlx/tokio ecosystem link against
            pkg-config
            openssl

            # local Postgres client (psql) for the migration/verification steps
            postgresql_16

            # frontend (frontend/)
            nodejs
          ];

          shellHook = ''
            export DATABASE_URL="postgres://excalistore:password@localhost:5432/excalistore"
          '';
        };
      });
}
