package account

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/binary"
	"fmt"
	"sort"
	"strings"
)

// Quiz holds randomly chosen word positions the user must echo back from
// a mnemonic just shown to them, plus the correct words. Answers are
// unexported — never returned to callers.
type Quiz struct {
	Positions []int
	answers   []string
}

// NewQuiz picks `count` unique random positions from the mnemonic.
func NewQuiz(m Mnemonic, count int) (*Quiz, error) {
	if err := m.Validate(); err != nil {
		return nil, err
	}
	words := strings.Fields(string(m))
	n := len(words)
	if count < 1 || count > n {
		return nil, fmt.Errorf("count out of range: %d (mnemonic has %d words)", count, n)
	}
	positions := pickUnique(n, count)
	answers := make([]string, count)
	for i, p := range positions {
		answers[i] = strings.ToLower(words[p])
	}
	return &Quiz{Positions: positions, answers: answers}, nil
}

// pickUnique returns k unique indices in [0,n) using crypto/rand.
func pickUnique(n, k int) []int {
	chosen := map[int]struct{}{}
	for len(chosen) < k {
		var b [8]byte
		_, _ = rand.Read(b[:])
		idx := int(binary.BigEndian.Uint64(b[:]) % uint64(n))
		chosen[idx] = struct{}{}
	}
	out := make([]int, 0, k)
	for p := range chosen {
		out = append(out, p)
	}
	sort.Ints(out)
	return out
}

// Check returns nil iff answers matches stored words at stored positions.
// Case-insensitive, whitespace-trimmed, constant-time per entry.
func (q *Quiz) Check(answers []string) error {
	if len(answers) != len(q.answers) {
		return fmt.Errorf("wrong answer count: got %d, want %d", len(answers), len(q.answers))
	}
	ok := 1
	for i, a := range answers {
		got := strings.ToLower(strings.TrimSpace(a))
		want := q.answers[i]
		if subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 {
			ok = 0
		}
	}
	if ok != 1 {
		return fmt.Errorf("quiz answers do not match")
	}
	return nil
}
