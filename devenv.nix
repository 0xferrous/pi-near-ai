{ pkgs, ... }:

{
  packages = [
    pkgs.nodejs_24
    pkgs.typescript_5
  ];

  enterShell = ''
    echo "NEAR AI pi extension dev shell: Node $(node --version), TypeScript $(tsc --version)"
  '';
}
