/**
 * Next.js instrumentation hook — the safety net under every route, server
 * action and server component: any error Next catches on the server that
 * nobody handled is logged here as ONE structured line, tagged with the
 * feature derived from the path, so it reaches Axiom even from code that
 * was never migrated to the logger.
 *
 * Routes wrapped in `withRequestLog` log their own failure before Next sees
 * it; those don't reach this hook (the wrapper returns a 500 instead of
 * throwing).
 */
import type { Instrumentation } from "next";
import { logger, featureForPath } from "@/lib/observability/log";

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const path = request.path.split("?")[0];
  logger(featureForPath(path), {
    route: path,
    method: request.method,
    router: context.routerKind,
    route_path: context.routePath,
    route_type: context.routeType,
    render_source: context.renderSource,
  }).error("uncaught", err);
};
