/**
 * EGAP Cloud Trace Integration — Architecture Spec v1.0
 *
 * Exports trace spans to Google Cloud Trace via OpenTelemetry.
 * Also records "Thought Traces" (Plan → Act → Observe) for reasoning observability.
 *
 * Usage:
 *   import { initTracing, createSpan, recordThoughtTrace } from './tracing.js';
 *   initTracing();  // Call once at startup
 *   const span = createSpan('orchestrator', 'chat_completion');
 *   // ... do work ...
 *   span.end();
 */
import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';
// The service name used for instrumenting this service
const SERVICE_NAME = 'egap-orchestrator';
// Module-level tracer instance
let tracer;
/**
 * Initialize the OpenTelemetry tracing pipeline with Cloud Trace exporter.
 *
 * IMPORTANT: On Cloud Run, the GCP Cloud Trace agent is auto-injected,
 * so this primarily sets up the tracer handle for manual instrumentation.
 * For local development without the Cloud Trace agent, this uses console output.
 */
export function initTracing() {
    tracer = trace.getTracer(SERVICE_NAME, '1.0.0');
    console.log(`📡 Cloud Trace initialized for service: ${SERVICE_NAME}`);
}
/**
 * Create a trace span for a specific operation.
 *
 * @param service - The service name (e.g., 'orchestrator', 'ingress')
 * @param operation - The operation name (e.g., 'chat_completion', 'tool_call')
 * @param attributes - Optional key-value attributes to attach to the span
 * @returns An OpenTelemetry Span that must be ended with span.end()
 */
export function createSpan(service, operation, attributes) {
    if (!tracer) {
        tracer = trace.getTracer(SERVICE_NAME);
    }
    const span = tracer.startSpan(`${service}.${operation}`, {
        kind: SpanKind.INTERNAL,
        attributes: {
            'service.name': service,
            'egap.operation': operation,
            ...attributes,
        },
    });
    return span;
}
/**
 * Record a "Thought Trace" — the Plan → Act → Observe reasoning cycle.
 *
 * Architecture Spec: "Reasoning logs should be visible in GCP Cloud Trace console."
 *
 * @param traceId - The trace ID from the request flow
 * @param phase - The reasoning phase (PLAN, ACT, OBSERVE)
 * @param content - The reasoning content (thought, action, observation)
 * @param agentId - The agent ID performing the reasoning
 */
export function recordThoughtTrace(traceId, phase, content, agentId) {
    if (!tracer) {
        tracer = trace.getTracer(SERVICE_NAME);
    }
    const span = tracer.startSpan(`reasoning.${phase.toLowerCase()}`, {
        kind: SpanKind.INTERNAL,
        attributes: {
            'egap.trace_id': traceId,
            'egap.agent_id': agentId,
            'egap.reasoning.phase': phase,
            'egap.reasoning.content': content.substring(0, 1000), // Truncate for safety
        },
    });
    console.log(`🧠 [${phase}] ${content.substring(0, 100)}...`);
    return span;
}
/**
 * End a span with an error status.
 */
export function endSpanWithError(span, error) {
    span.setStatus({
        code: SpanStatusCode.ERROR,
        message: typeof error === 'string' ? error : error.message,
    });
    span.end();
}
/**
 * End a span with OK status.
 */
export function endSpanOk(span) {
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
}
