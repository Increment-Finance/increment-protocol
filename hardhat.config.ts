import { HardhatUserConfig } from "hardhat/config";

import "@nomiclabs/hardhat-vyper";
import "@matterlabs/hardhat-zksync-node";
import "@matterlabs/hardhat-zksync-deploy";
import "@matterlabs/hardhat-zksync-solc";
import "@matterlabs/hardhat-zksync-vyper";
import "@matterlabs/hardhat-zksync-verify";

const config: HardhatUserConfig = {
  defaultNetwork: "zkSyncSepoliaTestnet",
  paths: {
    sources: "helpers"
  },
  networks: {
    zkSyncSepoliaTestnet: {
      url: "https://sepolia.era.zksync.dev",
      ethNetwork: "https://rpc.sepolia.org",
      zksync: true,
      verifyURL: "https://explorer.sepolia.era.zksync.dev/contract_verification"
    },
    zkSyncMainnet: {
      url: "https://mainnet.era.zksync.io",
      ethNetwork: "mainnet",
      zksync: true,
      verifyURL:
        "https://zksync2-mainnet-explorer.zksync.io/contract_verification"
    },
    dockerizedNode: {
      url: "http://localhost:3050",
      ethNetwork: "http://localhost:8545",
      zksync: true
    },
    inMemoryNode: {
      url: "http://127.0.0.1:8011",
      ethNetwork: "", // in-memory node doesn't support eth node; removing this line will cause an error
      zksync: true
    },
    hardhat: {
      zksync: true
    }
  },
  zksolc: {
    version: "latest",
    settings: {
      optimizer: {
        enabled: true,
        mode: "z"
      },
      // find all available options in the official documentation
      // https://era.zksync.io/docs/tools/hardhat/hardhat-zksync-solc.html#configuration
      isSystem: true
    }
  },
  zkvyper: {
    version: "1.3.17",
    settings: {
      // find all available options in the official documentation
      // https://era.zksync.io/docs/tools/hardhat/hardhat-zksync-vyper.html#configuration
    }
  },
  solidity: {
    compilers: [
      {
        version: "0.8.16"
      },
      {
        version: "0.8.20"
      }
    ]
  },
  // Currently, only Vyper 0.3.3 or 0.3.9 are supported.
  vyper: {
    compilers: [
      {
        version: "0.3.3"
      },
      {
        version: "0.3.10"
      }
    ]
  }
};

export default config;
