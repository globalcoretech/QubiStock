import { Feedback } from "../types";
import { Check, AlertCircle } from "./icons";

export function FeedbackBanner({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) return null;

  return (
    <div
      className={`p-3.5 rounded-input text-sm font-medium border flex items-center gap-2.5 ${
        feedback.isError
          ? "bg-terracotta/10 border-terracotta/30 text-terracotta"
          : "bg-leaf/10 border-leaf/30 text-leaf"
      }`}
    >
      {feedback.isError ? (
        <AlertCircle size={16} className="text-terracotta flex-shrink-0" />
      ) : (
        <Check size={16} className="text-leaf flex-shrink-0" />
      )}
      <span className="flex-1 leading-relaxed">{feedback.message}</span>
    </div>
  );
}

export function EmptyTableMessage({
  message,
  actionText,
  onAction,
}: {
  message: string;
  actionText?: string;
  onAction?: () => void;
}) {
  return (
    <div className="py-8 px-4 text-center">
      <p className="text-slate-400 text-sm">{message}</p>
      {actionText && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-3 btn-secondary text-xs py-1.5 px-3 min-h-[36px]"
        >
          {actionText}
        </button>
      )}
    </div>
  );
}
