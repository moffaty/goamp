package account

import (
	"strings"
	"testing"
)

func TestQuizPositionsUniqueAndInRange(t *testing.T) {
	m := Mnemonic("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about")
	q, err := NewQuiz(m, 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(q.Positions) != 3 {
		t.Fatalf("want 3 positions, got %d", len(q.Positions))
	}
	seen := map[int]bool{}
	for _, p := range q.Positions {
		if p < 0 || p >= 12 {
			t.Fatalf("position out of range: %d", p)
		}
		if seen[p] {
			t.Fatalf("duplicate position: %d", p)
		}
		seen[p] = true
	}
}

func TestQuizCheckAccepts(t *testing.T) {
	m := Mnemonic("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about")
	q, _ := NewQuiz(m, 3)
	words := strings.Fields(string(m))
	answers := make([]string, len(q.Positions))
	for i, p := range q.Positions {
		answers[i] = words[p]
	}
	if err := q.Check(answers); err != nil {
		t.Fatalf("Check rejected correct answers: %v", err)
	}
}

func TestQuizCheckRejectsWrong(t *testing.T) {
	m := Mnemonic("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about")
	q, _ := NewQuiz(m, 3)
	bad := []string{"wrong", "wrong", "wrong"}
	if err := q.Check(bad); err == nil {
		t.Fatal("expected rejection")
	}
}

func TestQuizCheckRejectsWrongArity(t *testing.T) {
	m := Mnemonic("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about")
	q, _ := NewQuiz(m, 3)
	if err := q.Check([]string{"only", "two"}); err == nil {
		t.Fatal("expected rejection for wrong-length answers")
	}
}
