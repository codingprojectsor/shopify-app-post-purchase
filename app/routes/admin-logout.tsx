import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { clearAdminSessionCookie } from "../utils/admin-auth.server";

// POST — form submission
export const action = async (_args: ActionFunctionArgs) => {
  return redirect("/admin-login", {
    headers: { "Set-Cookie": clearAdminSessionCookie() },
  });
};

// GET — direct URL visit also clears cookie (both paths in case old cookie lingers)
export const loader = async (_args: LoaderFunctionArgs) => {
  return redirect("/admin-login", {
    headers: [
      ["Set-Cookie", clearAdminSessionCookie()],
      ["Set-Cookie", "admin_session=; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=0"],
    ],
  });
};
