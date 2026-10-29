package healthlab

import "testing"

func TestInferFlag(t *testing.T) {
	cases := []struct {
		name   string
		status ResultStatus
		value  string
		ref    string
		want   string
	}{
		{"normal stays normal", ResultNormal, "5.0", "4 - 6", "normal"},
		{"critical stays critical", ResultCritical, "11.2", "< 1.7", "critical"},
		{"below a span is low", ResultAbnormal, "3.1", "4.0 - 6.0", "low"},
		{"above a span is high", ResultAbnormal, "7.2", "4.0 - 6.0", "high"},
		{"en dash span", ResultAbnormal, "7.2", "4.0 – 6.0", "high"},
		{"over an upper bound is high", ResultAbnormal, "6.8", "< 5.2", "high"},
		{"under a lower bound is low", ResultAbnormal, "0.8", "> 1.0", "low"},
		{"non-numeric value is plain abnormal", ResultAbnormal, "Positive", "Negative", "abnormal"},
		{"unparseable range is plain abnormal, never a guess", ResultAbnormal, "7.2", "see note", "abnormal"},
		{"in-range abnormal (range disagrees) is plain abnormal", ResultAbnormal, "5.0", "4.0 - 6.0", "abnormal"},
	}
	for _, tc := range cases {
		if got := inferFlag(tc.status, tc.value, tc.ref); got != tc.want {
			t.Errorf("%s: inferFlag(%s,%q,%q) = %q, want %q", tc.name, tc.status, tc.value, tc.ref, got, tc.want)
		}
	}
}
