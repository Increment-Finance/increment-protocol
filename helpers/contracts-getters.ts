import {tEthereumAddress} from './types';
import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {
  CurveTokenV5,
  CurveCryptoSwap2ETH,
  Factory,
  CurveTokenV5__factory,
  CurveCryptoSwap2ETH__factory,
  Factory__factory,
} from '../typechain';

import {getEthereumNetworkFromHRE} from '../helpers/misc-utils';
import {integrations} from '../markets/ethereum';
import {BigNumber} from 'ethers';

import {ethers} from 'hardhat';

export function getCurveFactoryAddress(
  hre: HardhatRuntimeEnvironment
): tEthereumAddress {
  return integrations.contracts[getEthereumNetworkFromHRE(hre)]
    .CURVE_FACTORY_CONTRACT;
}

export function getChainlinkOracle(
  hre: HardhatRuntimeEnvironment,
  pair: string
): tEthereumAddress {
  return integrations.chainlinkOracles.priceOracles[
    getEthereumNetworkFromHRE(hre)
  ][pair];
}

export async function getChainlinkPrice(
  hre: HardhatRuntimeEnvironment,
  pair: string
): Promise<BigNumber> {
  /* We have to use the chainlink price here since we use the oracle price to distribute the initial liquidity
  in the perpetual contracts. In case the price changes during deployment, the deployment could (potentially) fail.
  */
  const chainlinkOracle = await hre.ethers.getContractAt(
    'AggregatorV3Interface',
    getChainlinkOracle(hre, pair)
  );
  if (!chainlinkOracle) {
    throw new Error(
      `Could not get chainlink oracle for ${pair}, on network ${hre.network}`
    );
  }
  const answer = await chainlinkOracle.latestRoundData();
  const decimals = await chainlinkOracle.decimals();
  const priceAsString = hre.ethers.utils.formatUnits(answer.answer, decimals);
  return hre.ethers.utils.parseEther(priceAsString);
}

export async function getCryptoSwapFactory(
  hre: HardhatRuntimeEnvironment
): Promise<Factory> {
  return <Factory>(
    await ethers.getContractAt(
      Factory__factory.abi,
      getCurveFactoryAddress(hre)
    )
  );
}

export async function getCryptoSwap(
  factory: Factory,
  vQuoteAddress: string,
  vBaseAddress: string
): Promise<CurveCryptoSwap2ETH> {
  const cryptoSwapAddress = await factory[
    'find_pool_for_coins(address,address)'
  ](vQuoteAddress, vBaseAddress);

  return <CurveCryptoSwap2ETH>(
    await ethers.getContractAt(
      CurveCryptoSwap2ETH__factory.abi,
      cryptoSwapAddress
    )
  );
}

export async function getCurveToken(
  cryptoswap: CurveCryptoSwap2ETH
): Promise<CurveTokenV5> {
  const curveTokenAddress = await cryptoswap.token();

  return <CurveTokenV5>(
    await ethers.getContractAt(CurveTokenV5__factory.abi, curveTokenAddress)
  );
}

export function getReserveAddress(
  reserveAssetName: string,
  hre: HardhatRuntimeEnvironment
): tEthereumAddress {
  return integrations.ReserveConfig.ReserveAssets[
    getEthereumNetworkFromHRE(hre)
  ][reserveAssetName];
}

export function getLendingPoolAddressProvider(
  hre: HardhatRuntimeEnvironment
): tEthereumAddress {
  return integrations.contracts[getEthereumNetworkFromHRE(hre)]
    .AAVE_CONTRACTS_GATEWAY;
}

export function getFeedRegistryAddress(
  hre: HardhatRuntimeEnvironment
): tEthereumAddress {
  return integrations.chainlinkOracles.priceOracles[
    getEthereumNetworkFromHRE(hre)
  ].FEED_REGISTRY;
}
