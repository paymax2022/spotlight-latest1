package queue

import (
	"encoding/json"
	"fmt"

	"github.com/hibiken/asynq"
)

// Task type constants — all background jobs use these.
const (
	TypeWalletCreditNotify    = "wallet:credit:notify"
	TypeWalletDebitNotify     = "wallet:debit:notify"
	TypeReferralOutboxProcess = "referral:outbox:process"
	TypeBankTransferInitiate  = "bank:transfer:initiate"
	TypeBankTransferWebhook   = "bank:transfer:webhook"
	TypeKYCProvisioned        = "kyc:provisioned"
	TypeVAProvision           = "va:provision"
	TypeNotificationPush      = "notification:push"
	TypeNotificationEmail     = "notification:email"
	TypeNotificationSMS       = "notification:sms"
	TypeReconciliationRun     = "reconciliation:run"
	TypeOutboxSync            = "outbox:es:sync"
)

// Client wraps asynq.Client for enqueuing jobs.
type Client = asynq.Client

// Server wraps asynq.Server for processing jobs.
type Server = asynq.Server

// Task wraps asynq.Task.
type Task = asynq.Task

// Payload is a convenience alias for any JSON-serialisable map.
type Payload map[string]any

// NewClient creates an asynq client that enqueues to Redis at the given URL.
func NewClient(redisURL string) (*asynq.Client, error) {
	opts, err := asynq.ParseRedisURI(redisURL)
	if err != nil {
		return nil, fmt.Errorf("queue: parse redis url: %w", err)
	}
	return asynq.NewClient(opts), nil
}

// NewServer creates an asynq server that pulls from Redis.
func NewServer(redisURL string, concurrency int) (*asynq.Server, error) {
	opts, err := asynq.ParseRedisURI(redisURL)
	if err != nil {
		return nil, fmt.Errorf("queue: parse redis url: %w", err)
	}
	return asynq.NewServer(opts, asynq.Config{
		Concurrency: concurrency,
		Queues: map[string]int{
			"critical": 6,
			"default":  3,
			"low":      1,
		},
	}), nil
}

// NewTask serialises payload to JSON and creates an asynq task.
func NewTask(taskType string, payload any, opts ...asynq.Option) (*asynq.Task, error) {
	b, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("queue: marshal payload for %s: %w", taskType, err)
	}
	return asynq.NewTask(taskType, b, opts...), nil
}

// DecodePayload unmarshals task payload into dst.
func DecodePayload(t *asynq.Task, dst any) error {
	return json.Unmarshal(t.Payload(), dst)
}
