import { fetchWithRetry, readJsonOrThrow } from "./http.js";

const RELEASES_URL = "https://poggit.pmmp.io/releases.min.json";

export async function fetchPoggitReleases(userAgent) {
  const response = await fetchWithRetry(
    RELEASES_URL,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": userAgent,
      },
    },
    { label: "poggit releases.min.json" }
  );

  const data = await readJsonOrThrow(response, "Fetch Poggit releases");
  if (!Array.isArray(data)) {
    throw new Error("Unexpected Poggit response: expected an array");
  }

  return data.filter((item) => item && typeof item === "object");
}
