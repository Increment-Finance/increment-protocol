import {User} from './setup';
import {ethers} from 'hardhat';

import {LibPerpetual} from '../../typechain/contracts/Perpetual';
import {
  CurveCryptoSwap2ETH,
  CurveCryptoSwap2ETH__factory,
  CurveTokenV5,
  CurveTokenV5__factory,
} from '../../typechain';
import {TestPerpetual__factory, TestPerpetual, ERC20} from '../../typechain';

import {BigNumber, BigNumberish} from 'ethers';

/* ********************************* */
/*     Contract GETTERS              */
/* ********************************* */

export async function getPerpetual(
  user: User,
  marketIdx: BigNumberish = 0
): Promise<TestPerpetual> {
  return <TestPerpetual>(
    await ethers.getContractAt(
      TestPerpetual__factory.abi,
      await user.clearingHouse.perpetuals(marketIdx)
    )
  );
}

export async function getMarket(
  user: User,
  marketIdx: BigNumberish = 0
): Promise<CurveCryptoSwap2ETH> {
  return <CurveCryptoSwap2ETH>(
    await ethers.getContractAt(
      CurveCryptoSwap2ETH__factory.abi,
      await user.clearingHouseViewer.getMarket(marketIdx)
    )
  );
}

export async function getToken(
  user: User,
  marketIdx: BigNumberish = 0
): Promise<CurveTokenV5> {
  const market = await getMarket(user, marketIdx);
  return <CurveTokenV5>(
    await ethers.getContractAt(CurveTokenV5__factory.abi, await market.token())
  );
}

export async function getPerpetualFromMarket(
  market: CurveCryptoSwap2ETH
): Promise<TestPerpetual> {
  const token = <CurveTokenV5>(
    await ethers.getContractAt(CurveTokenV5__factory.abi, await market.token())
  );

  return <TestPerpetual>(
    await ethers.getContractAt(TestPerpetual__factory.abi, await token.minter())
  );
}
/* ********************************* */
/*     State GETTERS                 */
/* ********************************* */

export async function getGlobalPosition(
  user: User,
  marketIdx: BigNumberish = 0
): Promise<LibPerpetual.GlobalPositionStructOutput> {
  return <LibPerpetual.GlobalPositionStructOutput>(
    await user.clearingHouseViewer.getGlobalPosition(marketIdx)
  );
}

export async function getTotalSupply(
  market: CurveCryptoSwap2ETH
): Promise<BigNumber> {
  return await (<ERC20>(
    await ethers.getContractAt('ERC20', await market.token())
  )).totalSupply();
}
