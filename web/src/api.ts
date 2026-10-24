import {
  API_ROUTES,
  type AnalysisErrorCode,
  type ApiError,
  type CreateAnalysisMeta,
  type CreateAnalysisResponse,
  type GetAnalysisResponse,
} from "../../contracts";
export const ERROR_MESSAGES: Record<AnalysisErrorCode, string> = {
  consent_required: "Read and accept the consent before uploading.",
  invalid_image:
    "Retake with a short side of at least 480 pixels and without a panoramic frame.",
  error_no_face:
    "No face found. Face the camera in even light and remove obstructions.",
  error_src_face_too_small:
    "Move closer: your face should fill more than 60% of the image width.",
  provider_error:
    "Analysis could not finish. Try a new photo or the labeled sample.",
  timeout: "Still processing. Resume this job without uploading again.",
  quota_exhausted: "Live allowance is used up. Try Sample (pre-analyzed).",
  rate_limited:
    "Daily or concurrent limit reached. Wait, resume an existing job, or use the sample.",
  not_found: "Job no longer available. Use the sample or start again.",
  live_unavailable: "Live analysis is unavailable. Try the labeled sample.",
};
export class AnalysisError extends Error {
  constructor(public code: AnalysisErrorCode) {
    super(ERROR_MESSAGES[code]);
  }
}
export function createApi(fetcher: typeof fetch = fetch) {
  async function request<T>(url: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(url, init);
    } catch {
      throw new Error(
        "Connection failed. Check your connection, then resume the existing job if available. Do not upload again while it is processing.",
      );
    }
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as ApiError | null;
      throw new AnalysisError(
        data?.error?.code && data.error.code in ERROR_MESSAGES
          ? data.error.code
          : "provider_error",
      );
    }
    return response.json() as Promise<T>;
  }
  return {
    create(image: Blob, meta: CreateAnalysisMeta) {
      const body = new FormData();
      body.append("image", image, "selfie.jpg");
      body.append("meta", JSON.stringify(meta));
      return request<CreateAnalysisResponse>(API_ROUTES.createAnalysis, {
        method: "POST",
        body,
      });
    },
    get(id: string) {
      return request<GetAnalysisResponse>(API_ROUTES.getAnalysis(id));
    },
  };
}
