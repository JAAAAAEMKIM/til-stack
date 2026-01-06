import { rootRoute } from "./routes/__root";
import { indexRoute } from "./routes/index";
import { monthlyRoute } from "./routes/monthly";

export const routeTree = rootRoute.addChildren([indexRoute, monthlyRoute]);
