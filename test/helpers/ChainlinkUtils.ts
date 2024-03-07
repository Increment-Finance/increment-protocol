import {getChainlinkOracle} from '../../helpers/contracts-getters';
import {setLatestChainlinkPrice} from '../helpers/utils/manipulateStorage';
import {AggregatorV3Interface} from '../../typechain';
import {BigNumber} from 'ethers';
import {ethers} from 'hardhat';
import env = require('hardhat');

export async function changeChainlinkOraclePrice(
  price: BigNumber
): Promise<void> {
  const oracle: AggregatorV3Interface = await ethers.getContractAt(
    'AggregatorV3Interface',
    await getChainlinkOracle(env, 'EUR_USD')
  );
  await setLatestChainlinkPrice(env, oracle, price);
}
