package validate

// Data-splitting for leakage-free validation (§11).

// Fold is one purged-k-fold split: disjoint train/test index sets with a purge
// (and embargo) buffer removed from training around the test block.
type Fold struct {
	TrainIdx []int
	TestIdx  []int
}

// PurgedKFold splits [0,n) into k contiguous TEST blocks. For each, the TRAIN set
// is every index NOT within [testStart-purge, testEnd+embargo) — so labels that
// overlap the test window (purge) and a forward buffer (embargo) can't leak into
// training. This is the correct CV for serially-correlated financial data; a plain
// k-fold leaks and overstates performance. Deterministic. Returns nil for bad args.
func PurgedKFold(n, k, purge, embargo int) []Fold {
	if n <= 0 || k <= 1 || k > n {
		return nil
	}
	if purge < 0 {
		purge = 0
	}
	if embargo < 0 {
		embargo = 0
	}
	folds := make([]Fold, 0, k)
	blk := n / k
	for i := 0; i < k; i++ {
		testStart := i * blk
		testEnd := testStart + blk
		if i == k-1 {
			testEnd = n // last block absorbs the remainder
		}
		lo := testStart - purge
		hi := testEnd + embargo
		var f Fold
		for idx := testStart; idx < testEnd; idx++ {
			f.TestIdx = append(f.TestIdx, idx)
		}
		for idx := 0; idx < n; idx++ {
			if idx < lo || idx >= hi {
				f.TrainIdx = append(f.TrainIdx, idx)
			}
		}
		folds = append(folds, f)
	}
	return folds
}

// Window is one rolling walk-forward split (half-open [start,end) index ranges).
type Window struct {
	TrainStart, TrainEnd int
	TestStart, TestEnd   int
}

// WalkForwardWindows produces rolling train→test windows advancing by step. Train
// always PRECEDES its test (no future in training), and successive test segments
// move forward — the strategy must generalize across time, not fit one history.
func WalkForwardWindows(n, train, test, step int) []Window {
	if n <= 0 || train <= 0 || test <= 0 || step <= 0 {
		return nil
	}
	var ws []Window
	for start := 0; start+train+test <= n; start += step {
		ws = append(ws, Window{
			TrainStart: start, TrainEnd: start + train,
			TestStart: start + train, TestEnd: start + train + test,
		})
	}
	return ws
}
