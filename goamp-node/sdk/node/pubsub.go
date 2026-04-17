package node

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"

	goamppb "github.com/goamp/sdk/proto"
	"github.com/goamp/sdk/sdk"
	pubsub "github.com/libp2p/go-libp2p-pubsub"
	"google.golang.org/protobuf/proto"
)

// TopicProfiles is the GossipSub topic for taste profile exchange.
const TopicProfiles = "/goamp/profiles/1.0"

func (n *P2PNode) initPubSub(ctx context.Context) error {
	var err error
	n.ps, err = pubsub.NewGossipSub(ctx, n.host)
	if err != nil {
		return err
	}
	n.topic, err = n.ps.Join(TopicProfiles)
	if err != nil {
		return err
	}
	n.sub, err = n.topic.Subscribe()
	if err != nil {
		return err
	}
	go n.runSubscription(ctx)
	return nil
}

func (n *P2PNode) runSubscription(ctx context.Context) {
	for {
		msg, err := n.sub.Next(ctx)
		if err != nil {
			return // context cancelled or subscription closed
		}
		// Ignore our own messages.
		if msg.ReceivedFrom == n.host.ID() {
			continue
		}
		n.handleProfileMessage(ctx, msg.Data)
	}
}

func (n *P2PNode) handleProfileMessage(ctx context.Context, data []byte) {
	var profile goamppb.TasteProfile
	if err := proto.Unmarshal(data, &profile); err != nil {
		return // silently drop malformed messages
	}
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])

	if n.cfg.Profiles != nil {
		_ = n.cfg.Profiles.StorePeer(ctx, sdk.PeerProfile{
			Hash:    hash,
			Profile: &profile,
		})
	}

	payload, _ := json.Marshal(map[string]string{"hash": hash})
	n.Emit(sdk.Event{Type: sdk.EventProfileSynced, Payload: payload})
}

// PublishProfile serialises profile and publishes it to the profiles topic.
func (n *P2PNode) PublishProfile(ctx context.Context, profile *goamppb.TasteProfile) error {
	data, err := proto.Marshal(profile)
	if err != nil {
		return err
	}
	return n.topic.Publish(ctx, data)
}

// PublishRaw publishes raw bytes to topicName. Used in tests to inject
// malformed messages.
func (n *P2PNode) PublishRaw(ctx context.Context, topicName string, data []byte) error {
	if topicName == TopicProfiles {
		return n.topic.Publish(ctx, data)
	}
	// For other topics, join on demand.
	t, err := n.ps.Join(topicName)
	if err != nil {
		return err
	}
	return t.Publish(ctx, data)
}
