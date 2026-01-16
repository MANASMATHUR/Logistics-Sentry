import { assessDelayRisk } from "@/lib/logistics/agent";

export async function POST(req) {
    try {
        const body = await req.json();
        const { origin_port, carrier, mode } = body;

        if (!origin_port || !carrier) {
            return new Response(JSON.stringify({
                error: "Missing required fields: origin_port, carrier",
                example: { origin_port: "Port of Los Angeles", carrier: "Maersk", mode: "Sea" }
            }), {
                status: 400,
                headers: { "Content-Type": "application/json" }
            });
        }

        const result = await assessDelayRisk({ origin_port, carrier, mode });

        return new Response(JSON.stringify(result, null, 2), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}
