/**
 * Rewrites incoming custom-scheme and universal-link paths before Expo Router renders.
 * Route groups like (staff) must not appear in external URLs.
 */
export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): string {
  try {
    const raw = path.trim();
    if (!raw) return initial ? "/" : "/(auth)/login";

    const withoutScheme = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
    const pathAndQuery = withoutScheme.startsWith("/")
      ? withoutScheme
      : `/${withoutScheme}`;
    const qIndex = pathAndQuery.indexOf("?");
    const pathname = qIndex >= 0 ? pathAndQuery.slice(0, qIndex) : pathAndQuery;
    const search = qIndex >= 0 ? pathAndQuery.slice(qIndex) : "";

    const chatMatch = pathname.match(/\/chat\/([^/]+)$/);
    if (chatMatch) {
      return `/(staff)/chat/${decodeURIComponent(chatMatch[1])}${search}`;
    }

    const staffChat = pathname.match(/\/staff\/chat\/([^/]+)$/);
    if (staffChat) {
      return `/(staff)/chat/${decodeURIComponent(staffChat[1])}${search}`;
    }

    const openStaffChat = pathname.match(/\/open\/staff\/chat\/([^/]+)$/);
    if (openStaffChat) {
      return `/(staff)/chat/${decodeURIComponent(openStaffChat[1])}${search}`;
    }

    const signupVerify = pathname.match(/\/signup\/verify\/?$/);
    if (signupVerify) {
      return `/(auth)/signup/verify${search}`;
    }

    const customerChat = pathname.match(/\/chat\/c\/?$/);
    if (customerChat) {
      return `/(customer)/chat${search}`;
    }

    const openLogin = pathname.match(/\/open\/login\/?$/);
    if (openLogin) {
      return `/(customer)/chat${search}`;
    }

    const jobsMatch = pathname.match(/\/jobs\/([^/]+)$/);
    if (jobsMatch) {
      return `/(staff)/(jobs)/${decodeURIComponent(jobsMatch[1])}${search}`;
    }

    const staffJob = pathname.match(/\/staff\/jobs\/([^/]+)$/);
    if (staffJob) {
      return `/(staff)/(jobs)/${decodeURIComponent(staffJob[1])}${search}`;
    }

    // Legacy links that incorrectly included route group names in the scheme URL.
    const legacyChat = pathname.match(/\(staff\)\/chat\/([^/]+)/);
    if (legacyChat) {
      return `/(staff)/chat/${decodeURIComponent(legacyChat[1])}${search}`;
    }

    const legacyJob = pathname.match(/\(staff\)\/\(jobs\)\/([^/]+)/);
    if (legacyJob) {
      return `/(staff)/(jobs)/${decodeURIComponent(legacyJob[1])}${search}`;
    }

    return path;
  } catch {
    return initial ? "/" : "/(auth)/login";
  }
}
