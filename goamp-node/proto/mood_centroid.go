// Hand-written supplement to goamp.pb.go — regenerate with protoc when available.
// Defines MoodCentroid. MoodCentroids field is added to TasteProfile below.
// NOTE: MoodCentroids is not reflected in the proto binary descriptor so it is
// transported as JSON out-of-band (not via proto wire serialization).
package proto

// MoodCentroid holds a normalized tag-space centroid vector for a mood channel.
type MoodCentroid struct {
	Vec        []float32 `json:"vec"`
	TrackCount int32     `json:"track_count"`
	UpdatedAt  int64     `json:"updated_at"`
}

func (x *MoodCentroid) GetVec() []float32   { return x.Vec }
func (x *MoodCentroid) GetTrackCount() int32 { return x.TrackCount }
func (x *MoodCentroid) GetUpdatedAt() int64  { return x.UpdatedAt }
