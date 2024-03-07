import {eEthereumNetwork} from '../../helpers/types';

import {
  IReserveConfiguration,
  IChainlinkOracleConfig,
} from '../../helpers/types';

// ----------------
// Chainlink Oracles
// ----------------

export const chainlinkOracles: IChainlinkOracleConfig = {
  priceOracles: {
    [eEthereumNetwork.mainnet]: {
      USDC: '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6',
      JPY_USD: '0xBcE206caE7f0ec07b545EddE332A47C2F75bbeb3',
      EUR_USD: '0xb49f677943BC038e9857d61E7d053CaA2C1734C1',
      ETH_USD: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
      SEQUENCER: '',
    },
    [eEthereumNetwork.hardhat]: {
      USDC: '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6',
      JPY_USD: '0xBcE206caE7f0ec07b545EddE332A47C2F75bbeb3',
      EUR_USD: '0xb49f677943BC038e9857d61E7d053CaA2C1734C1',
      ETH_USD: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
      SEQUENCER: '',
    },
    [eEthereumNetwork.tenderly]: {
      USDC: '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6',
      JPY_USD: '0xBcE206caE7f0ec07b545EddE332A47C2F75bbeb3',
      EUR_USD: '0xb49f677943BC038e9857d61E7d053CaA2C1734C1',
      ETH_USD: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
      SEQUENCER: '',
    },
    [eEthereumNetwork.kovan]: {
      USDC: '0x9211c6b3BF41A10F78539810Cf5c64e1BB78Ec60',
      JPY_USD: '0xD627B1eF3AC23F1d3e576FA6206126F3c1Bd0942',
      EUR_USD: '0x0c15Ab9A0DB086e062194c273CC79f41597Bbf13',
      ETH_USD: '0x9326BFA02ADD2366b30bacB125260Af641031331',
      SEQUENCER: '',
    },
    [eEthereumNetwork.rinkeby]: {
      USDC: '0xa24de01df22b63d23Ebc1882a5E3d4ec0d907bFB',
      JPY_USD: '0x3Ae2F46a2D84e3D5590ee6Ee5116B80caF77DeCA',
      EUR_USD: '0x78F9e60608bF48a1155b4B2A5e31F32318a1d85F',
      ETH_USD: '0x8A753747A1Fa494EC906cE90E9f37563A8AF630e',
      SEQUENCER: '',
    },
    [eEthereumNetwork.zktestnet]: {
      USDC: '0x51906F8992439B900EDA3A82B4a23d8f3DF6E277',
      JPY_USD: '0x000000000000000000000000000000000000dead',
      EUR_USD: '0x442dbAe03732d7a55FBc3b86c89B5201910b4435',
      ETH_USD: '0xc249a2C0184F7b6eE73c75E8889bf78215e28De0',
      FEED_REGISTRY: '',
    },
  },
};

// ---------------------
// FACTORIES / GATEWAYS
// ---------------------

// at the time of writing (Feb 2022), the current factory contract is 0xF18056Bbd320E96A48e3Fbf8bC061322531aac99
// but it could change, if so, use the address provider contract at 0x0000000022d53366457f9d5e68ec105046fc4383
// ref: https://discord.com/channels/729808684359876718/729812922649542758/920105496546013204
// update for v2 factory: call get_address(6) to get the v2 factory
const CURVE_FACTORY_MAINNET = '0xF18056Bbd320E96A48e3Fbf8bC061322531aac99';

export const contracts = {
  [eEthereumNetwork.mainnet]: {
    AAVE_CONTRACTS_GATEWAY: '0xb53c1a33016b2dc2ff3653530bff1848a515c8c5',
    CURVE_FACTORY_CONTRACT: CURVE_FACTORY_MAINNET,
  },
  [eEthereumNetwork.hardhat]: {
    AAVE_CONTRACTS_GATEWAY: '0xb53c1a33016b2dc2ff3653530bff1848a515c8c5',
    CURVE_FACTORY_CONTRACT: CURVE_FACTORY_MAINNET, // reference to mainnet because we fork mainnet
  },
  [eEthereumNetwork.tenderly]: {
    AAVE_CONTRACTS_GATEWAY: '0xb53c1a33016b2dc2ff3653530bff1848a515c8c5',
    CURVE_FACTORY_CONTRACT: CURVE_FACTORY_MAINNET, // reference to mainnet because we fork mainnet
  },
  [eEthereumNetwork.kovan]: {
    AAVE_CONTRACTS_GATEWAY: '',
    CURVE_FACTORY_CONTRACT: '',
  },
  [eEthereumNetwork.rinkeby]: {
    AAVE_CONTRACTS_GATEWAY: '',
    CURVE_FACTORY_CONTRACT: '',
  },
  [eEthereumNetwork.zktestnet]: {
    AAVE_CONTRACTS_GATEWAY: '',
    CURVE_FACTORY_CONTRACT: '',
  },
};

// ----------------
// Token Addresses
// ----------------

export const ReserveConfig: IReserveConfiguration = {
  ReserveAssets: {
    [eEthereumNetwork.mainnet]: {
      USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    },
    [eEthereumNetwork.hardhat]: {
      USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    },
    [eEthereumNetwork.tenderly]: {
      USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    },
    // test networks use mock tokens
    [eEthereumNetwork.kovan]: {
      USDC: '',
    },
    [eEthereumNetwork.rinkeby]: {
      USDC: '',
    },
    [eEthereumNetwork.zktestnet]: {
      USDC: '',
    },
  },
};
