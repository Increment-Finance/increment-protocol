# @version 0.3.3
# (c) Curve.Fi, 2022
# Math for crypto pools
#
# Unless otherwise agreed on, only contracts owned by Curve DAO or
# Swiss Stake GmbH are allowed to call this contract.

N_COINS: constant(uint256) = 2  # <- change
A_MULTIPLIER: constant(uint256) = 10000

MIN_GAMMA: constant(uint256) = 10**10
MAX_GAMMA: constant(uint256) = 2 * 10**16

MIN_A: constant(uint256) = N_COINS**N_COINS * A_MULTIPLIER / 10
MAX_A: constant(uint256) = N_COINS**N_COINS * A_MULTIPLIER * 100000

EXP_PRECISION: constant(uint256) = 10**10


@internal
@pure
def _geometric_mean(unsorted_x: uint256[N_COINS], sort: bool) -> uint256:
    """
    (x[0] * x[1] * ...) ** (1/N)
    """
    x: uint256[N_COINS] = unsorted_x
    if sort and x[0] < x[1]:
        x = [unsorted_x[1], unsorted_x[0]]
    D: uint256 = x[0]
    diff: uint256 = 0
    for i in range(255):
        D_prev: uint256 = D
        # tmp: uint256 = 10**18
        # for _x in x:
        #     tmp = tmp * _x / D
        # D = D * ((N_COINS - 1) * 10**18 + tmp) / (N_COINS * 10**18)
        # line below makes it for 2 coins
        D = unsafe_div(D + x[0] * x[1] / D, N_COINS)
        if D > D_prev:
            diff = unsafe_sub(D, D_prev)
        else:
            diff = unsafe_sub(D_prev, D)
        if diff <= 1 or diff * 10**18 < D:
            return D
    raise "Did not converge"


@external
@view
def geometric_mean(unsorted_x: uint256[N_COINS], sort: bool) -> uint256:
  return self._geometric_mean(unsorted_x, sort)




@internal
@view
def _newton_D(ANN: uint256, gamma: uint256, x_unsorted: uint256[N_COINS]) -> uint256:
    """
    Finding the invariant using Newton method.
    ANN is higher by the factor A_MULTIPLIER
    ANN is already A * N**N

    Currently uses 60k gas
    """
    # Safety checks
    assert ANN > MIN_A - 1 and ANN < MAX_A + 1  # dev: unsafe values A
    assert gamma > MIN_GAMMA - 1 and gamma < MAX_GAMMA + 1  # dev: unsafe values gamma

    # Initial value of invariant D is that for constant-product invariant
    x: uint256[N_COINS] = x_unsorted
    if x[0] < x[1]:
        x = [x_unsorted[1], x_unsorted[0]]

    assert x[0] > 10**9 - 1 and x[0] < 10**15 * 10**18 + 1  # dev: unsafe values x[0]
    assert x[1] * 10**18 / x[0] > 10**14-1  # dev: unsafe values x[i] (input)

    D: uint256 = N_COINS * self._geometric_mean(x, False)
    S: uint256 = x[0] + x[1]
    __g1k0: uint256 = gamma + 10**18

    for i in range(255):
        D_prev: uint256 = D
        assert D > 0
        # Unsafe ivision by D is now safe

        # K0: uint256 = 10**18
        # for _x in x:
        #     K0 = K0 * _x * N_COINS / D
        # collapsed for 2 coins
        K0: uint256 = unsafe_div(unsafe_div((10**18 * N_COINS**2) * x[0], D) * x[1], D)

        _g1k0: uint256 = __g1k0
        if _g1k0 > K0:
            _g1k0 = unsafe_sub(_g1k0, K0) + 1  # > 0
        else:
            _g1k0 = unsafe_sub(K0, _g1k0) + 1  # > 0

        # D / (A * N**N) * _g1k0**2 / gamma**2
        mul1: uint256 = unsafe_div(unsafe_div(unsafe_div(10**18 * D, gamma) * _g1k0, gamma) * _g1k0 * A_MULTIPLIER, ANN)

        # 2*N*K0 / _g1k0
        mul2: uint256 = unsafe_div(((2 * 10**18) * N_COINS) * K0, _g1k0)

        neg_fprime: uint256 = (S + unsafe_div(S * mul2, 10**18)) + mul1 * N_COINS / K0 - unsafe_div(mul2 * D, 10**18)

        # D -= f / fprime
        D_plus: uint256 = D * (neg_fprime + S) / neg_fprime
        D_minus: uint256 = D*D / neg_fprime
        if 10**18 > K0:
            D_minus += unsafe_div(D * (mul1 / neg_fprime), 10**18) * unsafe_sub(10**18, K0) / K0
        else:
            D_minus -= unsafe_div(D * (mul1 / neg_fprime), 10**18) * unsafe_sub(K0, 10**18) / K0

        if D_plus > D_minus:
            D = unsafe_sub(D_plus, D_minus)
        else:
            D = unsafe_div(unsafe_sub(D_minus, D_plus), 2)

        diff: uint256 = 0
        if D > D_prev:
            diff = unsafe_sub(D, D_prev)
        else:
            diff = unsafe_sub(D_prev, D)
        if diff * 10**14 < max(10**16, D):  # Could reduce precision for gas efficiency here
            # Test that we are safe with the next newton_y
            for _x in x:
                frac: uint256 = _x * 10**18 / D
                assert (frac > 10**16 - 1) and (frac < 10**20 + 1)  # dev: unsafe values x[i]
            return D

    raise "Did not converge"

# @dev: modified version based on https://github.com/curvefi/curve-crypto-contract/blob/d7d04cd9ae038970e40be850df99de8c1ff7241b/contracts/two/CurveCryptoSwap2.vy#L332
@external
@view
def newton_D(ANN: uint256, gamma: uint256, x_unsorted: uint256[N_COINS]) -> uint256:
  return self._newton_D(ANN, gamma, x_unsorted)


@internal
@pure
def _newton_y(ANN: uint256, gamma: uint256, x: uint256[N_COINS], D: uint256, i: uint256) -> uint256:
    """
    Calculating x[i] given other balances x[0..N_COINS-1] and invariant D
    ANN = A * N**N
    """
    # Safety checks
    assert ANN > MIN_A - 1 and ANN < MAX_A + 1  # dev: unsafe values A
    assert gamma > MIN_GAMMA - 1 and gamma < MAX_GAMMA + 1  # dev: unsafe values gamma
    assert D > 10**17 - 1 and D < 10**15 * 10**18 + 1 # dev: unsafe values D

    x_j: uint256 = x[1 - i]
    y: uint256 = D**2 / (x_j * N_COINS**2)
    K0_i: uint256 = (10**18 * N_COINS) * x_j / D
    # S_i = x_j

    # frac = x_j * 1e18 / D => frac = K0_i / N_COINS
    assert (K0_i > 10**16*N_COINS - 1) and (K0_i < 10**20*N_COINS + 1)  # dev: unsafe values x[i]

    # x_sorted: uint256[N_COINS] = x
    # x_sorted[i] = 0
    # x_sorted = self.sort(x_sorted)  # From high to low
    # x[not i] instead of x_sorted since x_soted has only 1 element

    convergence_limit: uint256 = max(max(x_j / 10**14, D / 10**14), 100)

    __g1k0: uint256 = gamma + 10**18

    for j in range(255):
        y_prev: uint256 = y

        K0: uint256 = unsafe_div(K0_i * y * N_COINS, D)
        S: uint256 = x_j + y

        _g1k0: uint256 = __g1k0
        if _g1k0 > K0:
            _g1k0 = unsafe_sub(_g1k0, K0) + 1
        else:
            _g1k0 = unsafe_sub(K0, _g1k0) + 1

        # D / (A * N**N) * _g1k0**2 / gamma**2
        mul1: uint256 = unsafe_div(unsafe_div(unsafe_div(10**18 * D, gamma) * _g1k0, gamma) * _g1k0 * A_MULTIPLIER, ANN)

        # 2*K0 / _g1k0
        mul2: uint256 = unsafe_div(10**18 + (2 * 10**18) * K0, _g1k0)

        yfprime: uint256 = 10**18 * y + S * mul2 + mul1
        _dyfprime: uint256 = D * mul2
        if yfprime < _dyfprime:
            y = unsafe_div(y_prev, 2)
            continue
        else:
            yfprime = unsafe_sub(yfprime, _dyfprime)
        fprime: uint256 = yfprime / y

        # y -= f / f_prime;  y = (y * fprime - f) / fprime
        # y = (yfprime + 10**18 * D - 10**18 * S) // fprime + mul1 // fprime * (10**18 - K0) // K0
        y_minus: uint256 = mul1 / fprime
        y_plus: uint256 = (yfprime + 10**18 * D) / fprime + y_minus * 10**18 / K0
        y_minus += 10**18 * S / fprime

        if y_plus < y_minus:
            y = unsafe_div(y_prev, 2)
        else:
            y = unsafe_sub(y_plus, y_minus)

        diff: uint256 = 0
        if y > y_prev:
            diff = unsafe_sub(y, y_prev)
        else:
            diff = unsafe_sub(y_prev, y)
        if diff < max(convergence_limit, unsafe_div(y, 10**14)):
            frac: uint256 = unsafe_div(y * 10**18, D)
            assert (frac > 10**16 - 1) and (frac < 10**20 + 1)  # dev: unsafe value for y
            return y

    raise "Did not converge"

# @dev: modified version based on https://github.com/curvefi/curve-crypto-contract/blob/d7d04cd9ae038970e40be850df99de8c1ff7241b/contracts/two/CurveCryptoSwap2.vy#L332
@external
@view
def newton_y(ANN: uint256, gamma: uint256, x: uint256[N_COINS], D: uint256, i: uint256) -> uint256:
  return self._newton_y(ANN, gamma, x, D, i)


