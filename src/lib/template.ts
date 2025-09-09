import { Eta } from "eta";

const eta = new Eta({ views: "src/views", cache: true, autoEscape: true });

export const render = (
    template: string,
    data: Record<string, unknown> = {},
    extraHeaders: Record<string, string> = {},
) =>
    new Response(eta.render(template, data), {
        headers: { "Content-Type": "text/html; charset=utf-8", ...extraHeaders },
    });
