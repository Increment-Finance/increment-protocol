import {
  eEthereumNetwork,
  CurveCryptoSwap2ETHConfig,
  PerpetualConfig,
  ClearingHouseConfig,
  OracleConfig,
  markets,
  BaseConfig,
  reserveTokens,
  VaultReserveTokenConfig,
} from '../helpers/types';
import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {parameterization} from '../markets/ethereum';
import {getEthereumNetworkFromHRE} from '../helpers/misc-utils';

// ----------------
// CONTRACT CONFIGS
// ----------------

export function getOracleConfig(): OracleConfig {
  return parameterization.global.oracleConfig;
}

export function getClearingHouseConfig(): ClearingHouseConfig {
  return parameterization.global.clearingHouseConfig;
}

export function getVBaseConfig(pair: markets): BaseConfig {
  return parameterization.markets[pair].baseConfig;
}

export function getPerpetualConfigs(pair: markets): PerpetualConfig {
  return parameterization.markets[pair].perpetualConfig;
}

export function getCryptoSwapConfigs(pair: markets): CurveCryptoSwap2ETHConfig {
  return parameterization.markets[pair].cryptoSwapConfig;
}

export function getReserveTokenConfig(
  reserveToken: reserveTokens
): VaultReserveTokenConfig {
  return parameterization.global.vaultReserveTokenConfig[reserveToken];
}

// ----------------
// CONTRACT VERSION GETTERS
// ----------------

export function getPerpetualVersionToUse(
  hre: HardhatRuntimeEnvironment
): string {
  if (getEthereumNetworkFromHRE(hre) === eEthereumNetwork.hardhat) {
    return 'TestPerpetual';
  }
  return 'Perpetual';
}

export function getVaultVersionToUse(hre: HardhatRuntimeEnvironment): string {
  if (getEthereumNetworkFromHRE(hre) === eEthereumNetwork.hardhat) {
    return 'TestVault';
  }
  return 'Vault';
}

export function getInsuranceVersionToUse(
  hre: HardhatRuntimeEnvironment
): string {
  if (getEthereumNetworkFromHRE(hre) === eEthereumNetwork.hardhat) {
    return 'TestInsurance';
  }
  return 'Insurance';
}

export function getCryptoSwapVersionToUse(
  hre: HardhatRuntimeEnvironment
): string {
  const network = getEthereumNetworkFromHRE(hre);
  if (
    network === eEthereumNetwork.zktestnet ||
    network === eEthereumNetwork.rinkeby ||
    network === eEthereumNetwork.kovan
  ) {
    return 'CurveCryptoSwapTest';
  }
  return 'CurveCryptoSwap2ETH';
}

export function getCurveTokenVersionToUse(
  hre: HardhatRuntimeEnvironment
): string {
  const network = getEthereumNetworkFromHRE(hre);
  if (
    network === eEthereumNetwork.zktestnet ||
    network === eEthereumNetwork.rinkeby ||
    network === eEthereumNetwork.kovan
  ) {
    return 'CurveTokenV5Test';
  }
  return 'CurveTokenV5';
}
