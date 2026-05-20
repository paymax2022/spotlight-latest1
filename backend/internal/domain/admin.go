package domain

type AdminMenuCounts struct {
	Contestants int `json:"contestants"`
	Auditions   int `json:"auditions"`
	Academy     int `json:"academy"`
	RealityTV   int `json:"reality_tv"`
	SMEPitch    int `json:"sme_pitch"`
	Stem        int `json:"stem"`
	Bootcamp    int `json:"bootcamp"`
	OpenMic     int `json:"open_mic"`
}
