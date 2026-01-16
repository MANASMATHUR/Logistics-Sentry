import { runGenericAgent } from "../mino";

// --- STAGE 1: SOURCE DISCOVERY (KNOWLEDGE BASE) ---
// In a production system, this would be an LLM or specific search agent.
// For the Proof of Concept, we map known high-traffic nodes.
const SOURCE_KNOWLEDGE_BASE = {
    ports: {
        "Port of Los Angeles": [
            {
                name: "Port of LA - Operations Updates",
                url: "https://www.portoflosangeles.org", // Main page usually has alerts
                type: "port_authority"
            },
            {
                name: "MarineTraffic - Port Congestion (LA)",
                url: "https://www.marinetraffic.com/en/ais/details/ports/154/USA_port:LOS%20ANGELES",
                type: "congestion_data"
            }
        ],
        "Shanghai": [
            {
                name: "Shanghai International Port Group",
                url: "http://www.portshanghai.com.cn/en/",
                type: "port_authority"
            }
        ]
    },
    carriers: {
        "Maersk": [
            {
                name: "Maersk Network Advisories",
                url: "https://www.maersk.com/news/advisories",
                type: "carrier_advisory"
            }
        ],
        "MSC": [
            {
                name: "MSC Customer Advisories",
                url: "https://www.msc.com/en/newsroom/customer-advisories",
                type: "carrier_advisory"
            }
        ]
    }
    // Contextual sources like Weather or Labor generic sites could be added
};

// --- STAGE 2: PARALLEL AGENT EXECUTION ---
async function analyzeSource(source) {
    const goal = `
### MISSION: DEEP INTELLIGENCE EXTRACTION
TARGET URL: ${source.url}

You are a Logistics Intelligence Scout. Your job is to extract DETAILED operational intelligence from this page.

### INSTRUCTIONS:
1. Scan for specific **METRICS** (e.g., "Wait time: 3 days", "Anchored vessels: 12", "Gate turn time: 45 min", "Advisory #2024-05").
2. Extract **DIRECT QUOTES** from headers or alerts that describe the situation.
3. Identify **DATES** of specific upcoming disruptions (strikes, holidays, maintenance).
4. If operations are normal, extract the text that *says* they are normal (e.g., "All terminals open", "No delays reported").
5. DO NOT be vague. "Congestion" is bad. "Congestion: 5 day delay" is good.

### REQUIRED OUTPUT (JSON ONLY):
{
  "scan_status": "completed",
  "operational_status": "NORMAL" | "DISRUPTED" | "UNKNOWN",
  "signals": [
    {
      "summary": "Detailed finding with numbers/quotes if avaiable",
      "severity": "LOW" | "MEDIUM" | "HIGH",
      "date": "YYYY-MM-DD",
      "category": "METRIC" | "QUOTE" | "STATUS"
    }
  ]
}
`;

    try {
        console.log(`[Agent] Scouting ${source.name}...`);

        // Use a timeout race to prevent hanging agents
        const agentPromise = runGenericAgent(source.url, goal);
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Analysis timed out")), 28000)); // Slightly increased limit

        const stream = await Promise.race([agentPromise, timeoutPromise]);

        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let fullText = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            fullText += chunk;
        }

        const lines = fullText.split('\n');
        let finalResult = null;

        for (const line of lines) {
            if (line.startsWith("data: ")) {
                try {
                    const data = JSON.parse(line.slice(6));
                    if (data.final_result) {
                        finalResult = data.final_result;
                    }
                } catch (e) { }
            }
        }

        return {
            source: source.name,
            findings: finalResult
        };

    } catch (error) {
        console.error(`[Agent] Failed to analyze ${source.name}:`, error);
        return { source: source.name, error: error.message };
    }
}


// --- STAGE 3: SYNTHESIS & REASONING ---
function synthesizeRisk(context, findings) {
    let riskScore = 0;
    let signals = [];
    let primaryCauses = new Set();

    findings.forEach(f => {
        if (f.findings && f.findings.signals) {
            f.findings.signals.forEach(s => {
                // Formatting the signal text to be more readable if it's a metric
                let formattedSignal = s.summary;
                if (s.category === "METRIC") formattedSignal = `[METRIC] ${s.summary}`;
                if (s.category === "QUOTE") formattedSignal = `"${s.summary}"`;

                signals.push({
                    source: f.source,
                    signal: formattedSignal,
                    date: s.date || "Just now",
                    severity: s.severity
                });

                if (s.severity === "HIGH") riskScore += 50;
                if (s.severity === "MEDIUM") riskScore += 20;
                if (s.severity === "LOW") riskScore += 0; // Low doesn't increase risk, but provides context

                if (s.severity !== "LOW") {
                    // Try to infer cause from summary keywords
                    const text = s.summary.toLowerCase();
                    if (text.includes("congestion") || text.includes("anchor") || text.includes("dweel")) primaryCauses.add("CONGESTION");
                    if (text.includes("strike") || text.includes("labor") || text.includes("union")) primaryCauses.add("LABOR");
                    if (text.includes("weather") || text.includes("storm") || text.includes("fog") || text.includes("wind")) primaryCauses.add("WEATHER");
                    if (text.includes("maintenance") || text.includes("outage")) primaryCauses.add("TECHNICAL");
                }
            });
        } else if (f.error) {
            signals.push({
                source: f.source,
                signal: "Connection timed out during deep scan.",
                date: "Now",
                severity: "LOW"
            });
        } else {
            // Fallback for empty findings (likely normal)
            signals.push({
                source: f.source,
                signal: "Verified: No negative operational constraints found.",
                date: "Now",
                severity: "LOW"
            });
        }
    });

    let riskLevel = "LOW";
    if (riskScore >= 50) riskLevel = "HIGH";
    else if (riskScore >= 20) riskLevel = "MEDIUM";

    let confidence = 0.85;
    const causes = Array.from(primaryCauses).join(" + ");

    // Generate specific recommendation
    let action = "Network operating normally. Continue standard monitoring.";
    if (riskLevel === "HIGH") {
        if (causes.includes("LABOR")) action = "CRITICAL: Divert cargo immediately. Labor action confirmed.";
        else if (causes.includes("WEATHER")) action = "Schedule slide inevitable. Notify customers of delay.";
        else action = "High risk detected. Contact carrier representative.";
    } else if (riskLevel === "MEDIUM") {
        if (causes.includes("CONGESTION")) action = "Anticipate 2-4 day berthing delay. Monitor vessel position.";
        else action = "Monitor closely. Minor disruptions reported.";
    }

    return {
        shipment_context: context,
        risk_assessment: {
            delay_risk: riskLevel,
            primary_cause: causes || "Normal Operations",
            confidence: Math.min(0.99, confidence)
        },
        signals_detected: signals,
        recommended_action: action
    };
}


// --- MAIN ENTRY POINT ---
export async function assessDelayRisk(context) {
    const { origin_port, carrier, mode } = context;

    // 1. Discover
    const sources = [
        ...(SOURCE_KNOWLEDGE_BASE.ports[origin_port] || []),
        ...(SOURCE_KNOWLEDGE_BASE.carriers[carrier] || [])
    ];

    if (sources.length === 0) {
        return {
            error: "No intelligent sources found for this context.",
            supported_origins: Object.keys(SOURCE_KNOWLEDGE_BASE.ports),
            supported_carriers: Object.keys(SOURCE_KNOWLEDGE_BASE.carriers)
        };
    }

    // 2. Parallel Actions
    console.log(`[Orchestrator] Launching ${sources.length} agents for ${origin_port} / ${carrier}...`);
    const results = await Promise.all(sources.map(s => analyzeSource(s)));

    // 3. Synthesis
    return synthesizeRisk(context, results);
}
