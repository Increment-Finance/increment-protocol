import {BigNumber, BigNumberish} from 'ethers';

/********************** REGULAR TYPES **************************/

export {BigNumber} from 'ethers';

export interface SymbolMap<T> {
  [symbol: string]: T;
}

export type eNetwork = eEthereumNetwork;

export enum eEthereumNetwork {
  mainnet = 'mainnet',
  hardhat = 'hardhat',
  kovan = 'kovan',
  rinkeby = 'rinkeby',
  tenderly = 'tenderly',
  zktestnet = 'zktestnet',
}

export type tEthereumAddress = string;

export interface iEthereumParamsPerNetwork<T> {
  [eEthereumNetwork.mainnet]: T;
  [eEthereumNetwork.hardhat]: T;
  [eEthereumNetwork.tenderly]: T;
  [eEthereumNetwork.kovan]: T;
  [eEthereumNetwork.rinkeby]: T;
  [eEthereumNetwork.zktestnet]: T;
}

/********************** ADDRESS CONFIGURATION **************************/

// no chainlink support on ZkSync as of 01/04/2022
export interface IChainlinkOracleConfig {
  priceOracles: iEthereumParamsPerNetwork<SymbolMap<tEthereumAddress>>;
}

export interface IReserveConfiguration {
  ReserveAssets: iEthereumParamsPerNetwork<SymbolMap<tEthereumAddress>>;
}

/********************** CONTRACT PARAMETERIZATION  **************************/
export type reserveTokens = 'ua' | 'usdc' | 'dai';

export type markets = 'EUR_USD' | 'JPY_USD' | 'ETH_USD';

export interface Parameterization {
  global: GlobalConfig;
  markets: {
    [market in markets]: MarketConfig;
  };
}

/********************** GLOBAL  **************************/
export interface GlobalConfig {
  clearingHouseConfig: ClearingHouseConfig;
  oracleConfig: OracleConfig;
  vaultReserveTokenConfig: {
    [token in reserveTokens]: VaultReserveTokenConfig;
  };
  uaTokenConfig: {
    [token in reserveTokens]: uaTokenConfig;
  };
}

export type ClearingHouseConfig = {
  minMargin: BigNumber;
  minMarginAtCreation: BigNumber;
  minPositiveOpenNotional: BigNumber;
  liquidationReward: BigNumber;
  liquidationRewardInsuranceShare: BigNumber;
  liquidationDiscount: BigNumberish;
  insuranceRatio: BigNumber;
  nonUACollSeizureDiscount: BigNumber;
  uaDebtSeizureThreshold: BigNumber;
};

export type OracleConfig = {
  gracePeriod: BigNumberish;
};

export type VaultReserveTokenConfig = {
  weight: BigNumberish;
  maxAmount: BigNumberish;
};

export type uaTokenConfig = {
  maxMintCap: BigNumberish;
};

/********************** MARKET  **************************/

export interface MarketConfig {
  perpetualConfig: PerpetualConfig;
  baseConfig: BaseConfig;
  cryptoSwapConfig: CurveCryptoSwap2ETHConfig;
}

export type PerpetualConfig = {
  riskWeight: BigNumber;
  maxLiquidityProvided: BigNumber;
  twapFrequency: BigNumber;
  sensitivity: BigNumber;
  maxBlockTradeAmount: BigNumber;
  insuranceFee: BigNumber;
  lpDebtCoef: BigNumber;
};

export type BaseConfig = {
  heartBeat: BigNumberish;
  gracePeriod: BigNumberish;
};

export type CurveCryptoSwap2ETHConfig = {
  A: BigNumber;
  gamma: BigNumber;
  mid_fee: BigNumber;
  out_fee: BigNumber;
  allowed_extra_profit: BigNumber;
  fee_gamma: BigNumber;
  adjustment_step: BigNumber;
  admin_fee: BigNumber;
  ma_half_time: BigNumber;
};
