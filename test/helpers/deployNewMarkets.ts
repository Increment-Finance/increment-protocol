import env, {ethers} from 'hardhat';
import {expect} from 'chai';

// helpers
import {
  getChainlinkOracle,
  getChainlinkPrice,
  getCryptoSwap,
  getCryptoSwapFactory,
} from '../../helpers/contracts-getters';
import {
  getCryptoSwapConfigs,
  getPerpetualConfigs,
  getVBaseConfig,
} from '../../helpers/contracts-deployments';

// types
import {TestPerpetual, ClearingHouse, MockAggregator} from '../../typechain';

/*
What contracts don't we need to deploy?
- USDC (public token)
- Chainlink oracle

What contracts do we need to deploy once (for all trading pairs)?
- UA
- Vault
- Insurance
- Oracle
- ClearingHouse (+ ClearingHouseViewer)

What contracts do we need to deploy for a new trading pair?
- 2 virtual tokens, vBase and vQuote
- Curve pool for these 2 tokens, at their current ratio
- Perpetual
*/

// The function can't be totally flexible in the argument it takes to create new markets
// because it relies on values which are hardcoded elsewhere like the Chainlink pair addresses
export async function deployJPYUSDMarket(): Promise<TestPerpetual> {
  const [deployer] = await ethers.getSigners();

  // Addresses of Increment contracts deployed once only
  const clearingHouse = <ClearingHouse>(
    await ethers.getContract('ClearingHouse', deployer)
  );
  const sequencerUptimeFeed = <MockAggregator>(
    await ethers.getContract('MockAggregator', deployer)
  );

  // 1. Deploy virtual tokens (vJPY & vUSD)
  const VBase = await ethers.getContractFactory('VBase', deployer);
  const vBaseConfig = getVBaseConfig('JPY_USD');
  const vJPY = await VBase.deploy(
    'vJPY base token (JPY/USD pair)',
    'vJPY',
    getChainlinkOracle(env, 'JPY_USD'),
    vBaseConfig.heartBeat,
    sequencerUptimeFeed.address,
    vBaseConfig.gracePeriod
  );
  const VQuote = await ethers.getContractFactory('VQuote', deployer);
  const vUSD = await VQuote.deploy('vUSD quote token (JPY/USD pair)', 'vUSD');

  // 2. Create JPY/USD Curve pool
  const initialPrice = await getChainlinkPrice(env, 'JPY_USD');
  expect(initialPrice).to.be.gt(0);

  const cryptoSwapConfig = getCryptoSwapConfigs('JPY_USD');

  const cryptoSwapFactory = await getCryptoSwapFactory(env);
  await cryptoSwapFactory.deploy_pool(
    'JPY_USD',
    'JPY_USD',
    [vUSD.address, vJPY.address],
    cryptoSwapConfig.A,
    cryptoSwapConfig.gamma,
    cryptoSwapConfig.mid_fee,
    cryptoSwapConfig.out_fee,
    cryptoSwapConfig.allowed_extra_profit,
    cryptoSwapConfig.fee_gamma,
    cryptoSwapConfig.adjustment_step,
    cryptoSwapConfig.admin_fee,
    cryptoSwapConfig.ma_half_time,
    initialPrice
  );

  const pool = await getCryptoSwap(
    cryptoSwapFactory,
    vUSD.address,
    vJPY.address
  );

  // 3. Deploy JPY/USD Perpetual
  const TestPerpetual = await ethers.getContractFactory(
    'TestPerpetual',
    deployer
  );

  const cryptoViews = await ethers.getContract('CurveCryptoViews', deployer);
  const perpetualConfig = getPerpetualConfigs('JPY_USD');

  const JPYUSDPerpetual = <TestPerpetual>(
    await TestPerpetual.deploy(
      vJPY.address,
      vUSD.address,
      pool.address,
      clearingHouse.address,
      cryptoViews.address,
      perpetualConfig
    )
  );

  // Register vJPY/vUSD in ClearingHouse
  await (await vJPY.transferPerpOwner(JPYUSDPerpetual.address)).wait();
  await (await vUSD.transferPerpOwner(JPYUSDPerpetual.address)).wait();
  // Register new Perpetual market in ClearingHouse
  await (
    await clearingHouse.allowListPerpetual(JPYUSDPerpetual.address)
  ).wait();

  return JPYUSDPerpetual;
}

export async function deployETHUSDMarket(): Promise<TestPerpetual> {
  const [deployer] = await ethers.getSigners();

  // Addresses of Increment contracts deployed once only
  const clearingHouse = <ClearingHouse>(
    await ethers.getContract('ClearingHouse', deployer)
  );
  const sequencerUptimeFeed = <MockAggregator>(
    await ethers.getContract('MockAggregator', deployer)
  );

  // 1. Deploy virtual tokens (vETH & vUSD)
  const VBase = await ethers.getContractFactory('VBase', deployer);
  const vBaseConfig = getVBaseConfig('ETH_USD');
  const vETH = await VBase.deploy(
    'vETH base token (ETH/USD pair)',
    'vETH',
    getChainlinkOracle(env, 'ETH_USD'),
    vBaseConfig.heartBeat,
    sequencerUptimeFeed.address,
    vBaseConfig.gracePeriod
  );
  const VQuote = await ethers.getContractFactory('VQuote', deployer);
  const vUSD = await VQuote.deploy('vUSD quote token (ETH/USD pair)', 'vUSD');

  // 2. Create ETH/USD Curve pool
  const initialPrice = await getChainlinkPrice(env, 'ETH_USD');
  expect(initialPrice).to.be.gt(0);

  const cryptoSwapConfig = getCryptoSwapConfigs('ETH_USD');

  const cryptoSwapFactory = await getCryptoSwapFactory(env);
  await cryptoSwapFactory.deploy_pool(
    'ETH_USD',
    'ETH_USD',
    [vUSD.address, vETH.address],
    cryptoSwapConfig.A,
    cryptoSwapConfig.gamma,
    cryptoSwapConfig.mid_fee,
    cryptoSwapConfig.out_fee,
    cryptoSwapConfig.allowed_extra_profit,
    cryptoSwapConfig.fee_gamma,
    cryptoSwapConfig.adjustment_step,
    cryptoSwapConfig.admin_fee,
    cryptoSwapConfig.ma_half_time,
    initialPrice
  );

  const pool = await getCryptoSwap(
    cryptoSwapFactory,
    vUSD.address,
    vETH.address
  );

  // 3. Deploy ETH/USD Perpetual
  const TestPerpetual = await ethers.getContractFactory(
    'TestPerpetual',
    deployer
  );

  const cryptoViews = await ethers.getContract('CurveCryptoViews', deployer);
  const perpetualConfig = getPerpetualConfigs('ETH_USD');

  const ETHUSDPerpetual = <TestPerpetual>(
    await TestPerpetual.deploy(
      vETH.address,
      vUSD.address,
      pool.address,
      clearingHouse.address,
      cryptoViews.address,
      perpetualConfig
    )
  );

  // Register vETH/vUSD in ClearingHouse
  await (await vETH.transferPerpOwner(ETHUSDPerpetual.address)).wait();
  await (await vUSD.transferPerpOwner(ETHUSDPerpetual.address)).wait();
  // Register new Perpetual market in ClearingHouse
  await (
    await clearingHouse.allowListPerpetual(ETHUSDPerpetual.address)
  ).wait();

  return ETHUSDPerpetual;
}
