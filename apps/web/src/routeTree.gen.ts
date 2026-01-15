import { rootRoute } from "./routes/__root";
import { indexRoute } from "./routes/index";
import { monthlyRoute } from "./routes/monthly";
import { configRoute } from "./routes/config";
import { loginRoute } from "./routes/login";
import { authCallbackRoute } from "./routes/auth.callback";

export const routeTree = rootRoute.addChildren([
  indexRoute,
  monthlyRoute,
  configRoute,
  loginRoute,
  authCallbackRoute,
]);
