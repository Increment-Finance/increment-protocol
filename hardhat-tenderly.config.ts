import '@tenderly/hardhat-tenderly';
import {HardhatUserConfig} from 'hardhat/types';
import {node_url, accounts} from './helpers/network';

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
  return {};
};

const config: HardhatUserConfig = {
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
      //accounts: accounts('tenderly'),
      accounts: accounts('tenderly'),
      chainId: 1,
    },
  },
  solidity: {
    compilers: [
      {
        version: '0.8.15',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  tenderly: {
    project: 'staging-test',
    username: 'increment',
    forkNetwork: '1',
  },
};
export default config;
