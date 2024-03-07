import 'dotenv/config';
import 'hardhat-gas-reporter';
import 'hardhat-contract-sizer';

import '@nomiclabs/hardhat-vyper';
import '@matterlabs/hardhat-zksync-vyper';
import '@matterlabs/hardhat-zksync-solc';
import '@matterlabs/hardhat-zksync-deploy';

import 'hardhat-deploy';
import '@typechain/hardhat';
import '@nomiclabs/hardhat-etherscan';
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-waffle';

import 'solidity-coverage';
import 'hardhat-gas-reporter';
import 'hardhat-spdx-license-identifier';
import '@primitivefi/hardhat-dodoc';
import {HardhatUserConfig} from 'hardhat/types';
import {node_url, accounts} from './helpers/network';

// While waiting for hardhat PR: https://github.com/nomiclabs/hardhat/pull/1542
if (process.env.HARDHAT_FORK) {
  process.env['HARDHAT_DEPLOY_FORK'] = process.env.HARDHAT_FORK;
}

const getHardhatConf = () => {
  if (process.env.HARDHAT_FORK == 'mainnet') {
    return {
      // process.env.HARDHAT_FORK will specify the network that the fork is made from.
      // this line ensure the use of the corresponding accounts
      accounts: accounts(process.env.HARDHAT_FORK),
      forking: {
        url: node_url('MAINNET'),
        blockNumber: 14191019,
      },
      allowUnlimitedContractSize: true,
    };
  }
  return {
    accounts: accounts(process.env.HARDHAT_FORK),
    allowUnlimitedContractSize: true,
  };
};

const config: HardhatUserConfig = {
  zksolc: {
    compilerSource: 'docker',
    // compilerSource: 'binary', Status (10/08/2022): Binary files is broken () has not fixed the bug yet.
    settings: {
      // compilerPath:
      //   './lib/zksolc-bin/linux-amd64/zksolc-linux-amd64-musl-v1.1.4',
      experimental: {
        dockerImage: 'matterlabs/zksolc',
        tag: 'latest',
      },
    },
  },
  zkvyper: {
    // compilerSource: 'docker', Status (10/08/2022): Docker has not fixed the bug yet.
    compilerSource: 'binary',
    settings: {
      compilerPath:
        './lib/zkvyper-bin/linux-amd64/zkvyper-linux-amd64-musl-v1.1.1',
      // experimental: {
      //   dockerImage: 'matterlabs/zkvyper',
      //   tag: 'latest',
    },
  },
  zkSyncDeploy: {
    zkSyncNetwork: 'https://zksync2-testnet.zksync.dev',
    ethNetwork: node_url('goerli'),
  },
  defaultNetwork: 'hardhat',
  networks: {
    hardhat: getHardhatConf(),
    localhost: {
      url: node_url('localhost'),
      accounts: accounts(),
    },
    mainnet: {
      url: node_url('mainnet'),
      accounts: accounts('mainnet'),
    },
    rinkeby: {
      url: node_url('rinkeby'),
      accounts: accounts('rinkeby'),
    },
    kovan: {
      url: node_url('kovan'),
      accounts: accounts('kovan'),
    },
    tenderly: {
      url: node_url('tenderly'),
      accounts: accounts('tenderly'),
      chainId: 1,
    },
    zktestnet: {
      accounts: accounts('goerli'),
      zksync: true,
      url: 'https://zksync2-testnet.zksync.dev',
    },
  },
  solidity: {
    compilers: [
      {
        version: '0.8.15',
        settings: {
          optimizer: {
            enabled: true,
            runs: 2000,
          },
        },
      },
    ],
  },
  vyper: {
    compilers: [{version: '0.3.3'}],
  },
  namedAccounts: {
    deployer: {
      default: 0,
    },
    user: {
      default: 1,
    },
    bob: {
      default: 2,
    },
    alice: {
      default: 3,
    },
    trader: {
      default: 4,
    },
    lp: {
      default: 5,
    },
    traderTwo: {
      default: 6,
    },
    lpTwo: {
      default: 7,
    },
    liquidator: {
      default: '0x57485dDa80B2eA63F1f0bB5a8877Abf4C6d14f52',
    },
    frontend: {
      default: '0xB2a98504D0943163701202301f13E07aCE53bD11',
    },
    backend: {
      default: '0x43aC7bc6b21f6cCEC8d55e08ed752FEF9aFd174C',
    },
    tester: {
      default: '0xD8D12d91f2B52eE858CB34619979B2A80f9a9261',
    },
  },
  paths: {
    artifacts: 'artifacts',
    sources: 'contracts',
    tests: 'test',
    deploy: ['deploy'],
  },
  gasReporter: {
    currency: 'USD',
    gasPrice: 15,
    enabled: true,
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
    maxMethodDiff: 10,
    remoteContracts: [],
    // cat gasReporterOutputTmp.md | sed "s/\x1B\[[0-9;]\{1,\}[A-Za-z]//g" > gasReporterOutput.md
    outputFile: 'gasReporterOutputTmp.md',
  },
  typechain: {
    outDir: 'typechain',
    target: 'ethers-v5',
  },
  mocha: {
    timeout: 0,
  },
  contractSizer: {
    alphaSort: true,
    strict: true,
    only: [
      'Perpetual',
      'Vault',
      'Insurance',
      'ClearingHouse',
      'VBase',
      'VQuote',
    ],
  },
  dodoc: {
    outputDir: 'wiki/',
    include: [
      'Insurance',
      'Vault',
      'Perpetual',
      'ClearingHouse',
      'ClearingHouseViewer',
      'CurveCryptoViews',
      'VBase',
      'VQuote',
      'Oracle',
      'UA',
    ],
    exclude: ['node_modules'],
    runOnCompile: false,
  },
};
export default config;
