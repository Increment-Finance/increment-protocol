import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {getCryptoSwapConfigs} from '../helpers/contracts-deployments';
import {
  getCryptoSwapFactory,
  getChainlinkPrice,
} from '../helpers/contracts-getters';
import {ethers} from 'hardhat';

import {CurveCryptoSwapTest, CurveTokenV5Test} from '../typechain';

// import {getCryptoSwapConstructorArgsSeparate} from '../helpers/contracts-deployments';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployer} = await hre.getNamedAccounts();

  // constructor arguments
  const vEUR = await ethers.getContract('VBase', deployer);
  const vUSD = await ethers.getContract('VQuote', deployer);

  const initialPrice = await getChainlinkPrice(hre, 'EUR_USD');
  console.log(
    'Use EUR/USD price of ',
    hre.ethers.utils.formatEther(initialPrice)
  );

  if (
    hre.network.name === 'kovan' ||
    hre.network.name === 'rinkeby' ||
    hre.network.name === 'zktestnet'
  ) {
    // deploy testPool
    // @dev: Have to deploy CurveTokenV5Test here since CurveTokenV5 requires knowledge of the curve pool address
    //      (see: https://github.com/Increment-Finance/increment-protocol/blob/9142b5f1f413550a63c97e13aab12ae42d46a1d0/contracts-vyper/contracts/Factory.vy#L208)

    // deploy curve token
    await hre.deployments.deploy('CurveTokenV5Test', {
      from: deployer,
      args: ['EUR_USD', 'EUR_USD'],
      log: true,
    });
    const token = <CurveTokenV5Test>(
      await ethers.getContract('CurveTokenV5Test', deployer)
    );

    // deploy curve pool
    const config = getCryptoSwapConfigs('EUR_USD');
    await hre.deployments.deploy('CurveCryptoSwapTest', {
      from: deployer,
      args: [
        deployer,
        '0xeCb456EA5365865EbAb8a2661B0c503410e9B347', // from: https://github.com/curvefi/curve-crypto-contract/blob/f66b0c7b33232b431a813b9201e47a35c70db1ab/scripts/deploy_mainnet_eurs_pool.py#L18
        config.A,
        config.gamma,
        config.mid_fee,
        config.out_fee,
        config.allowed_extra_profit,
        config.fee_gamma,
        config.adjustment_step,
        config.admin_fee,
        config.ma_half_time,
        initialPrice,
        token.address,
        [vUSD.address, vEUR.address],
      ],
      log: true,
    });

    const cryptoSwap = <CurveCryptoSwapTest>(
      await ethers.getContract('CurveCryptoSwapTest', deployer)
    );

    if ((await token.minter()) !== cryptoSwap.address) {
      console.log('Set new minter');
      await (await token.set_minter(cryptoSwap.address)).wait();
    }
  } else {
    // deploy
    const config = getCryptoSwapConfigs('EUR_USD');

    const cryptoSwapFactory = await getCryptoSwapFactory(hre);
    console.log('Found CryptoSwapFactory at ', cryptoSwapFactory.address);

    await cryptoSwapFactory.deploy_pool(
      'EUR_USD',
      'EUR_USD',
      [vUSD.address, vEUR.address],
      config.A,
      config.gamma,
      config.mid_fee,
      config.out_fee,
      config.allowed_extra_profit,
      config.fee_gamma,
      config.adjustment_step,
      config.admin_fee,
      config.ma_half_time,
      initialPrice
    );
  }
};

func.tags = ['CurvePool'];
func.id = 'call_curve_factory_to_create_curve_pool';
func.dependencies = ['VirtualTokens'];

export default func;
