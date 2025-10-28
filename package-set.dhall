let upstream = https://github.com/dfinity/vessel-package-set/releases/download/mo-0.10.2-20231201/package-set.dhall

let packages = [
  { name = "json"
  , repo = "https://github.com/aviate-labs/json.mo"
  , version = "v0.2.2"
  , dependencies = ["base"]
  },
  { name = "sha2"
  , repo = "https://github.com/timohanke/motoko-sha2"
  , version = "v2.0.0"
  , dependencies = ["base"]
  }
]

in upstream # packages
