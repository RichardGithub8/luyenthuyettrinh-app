/** Danh mục mã lỗi dùng chung giữa API và giao diện. Client hiển thị `message` hoặc tự dịch theo `code`. */
export const ERRORS = {
  VALIDATION_FAILED:   { status: 422, vi: 'Dữ liệu chưa hợp lệ. Kiểm tra lại các trường được đánh dấu.', en: 'Some fields are invalid. Check the highlighted fields.' },
  UNAUTHENTICATED:     { status: 401, vi: 'Bạn cần đăng nhập để tiếp tục.', en: 'Please log in to continue.' },
  FORBIDDEN:           { status: 403, vi: 'Bạn không có quyền thực hiện thao tác này.', en: 'You don’t have permission to do this.' },
  NOT_FOUND:           { status: 404, vi: 'Không tìm thấy dữ liệu.', en: 'Not found.' },
  ONBOARDING_REQUIRED: { status: 409, vi: 'Hãy hoàn tất thiết lập tài khoản trước.', en: 'Please finish setting up your account first.' },
  EMAIL_TAKEN:         { status: 409, vi: 'Email này đã được đăng ký. Hãy đăng nhập hoặc chọn “Quên mật khẩu”.', en: 'This email is already registered. Log in or reset your password.' },
  INVALID_CREDENTIALS: { status: 401, vi: 'Email hoặc mật khẩu không đúng.', en: 'Wrong email or password.' },
  EMAIL_NOT_CONFIRMED: { status: 403, vi: 'Email chưa được xác thực. Kiểm tra hộp thư hoặc gửi lại email xác thực.', en: 'Your email isn’t verified yet. Check your inbox or resend the email.' },
  WEAK_PASSWORD:       { status: 422, vi: 'Mật khẩu cần ít nhất 8 ký tự, có cả chữ và số.', en: 'Use at least 8 characters with letters and numbers.' },
  SAME_PASSWORD:       { status: 422, vi: 'Mật khẩu mới phải khác mật khẩu cũ.', en: 'Your new password must be different.' },
  LINK_EXPIRED:        { status: 400, vi: 'Liên kết đã hết hạn hoặc đã được dùng. Hãy yêu cầu liên kết mới.', en: 'This link has expired or was already used. Request a new one.' },
  OAUTH_FAILED:        { status: 400, vi: 'Không đăng nhập được bằng Google. Vui lòng thử lại.', en: 'Google sign-in failed. Please try again.' },
  RATE_LIMITED:        { status: 429, vi: 'Bạn thao tác quá nhanh. Vui lòng đợi một chút rồi thử lại.', en: 'Too many attempts. Please wait a moment and try again.' },
  AUTH_FAILED:         { status: 400, vi: 'Không xử lý được yêu cầu xác thực. Vui lòng thử lại.', en: 'We couldn’t process this request. Please try again.' },
  PREMIUM_REQUIRED:    { status: 403, vi: 'Tính năng này có trong gói Premium.', en: 'This feature is part of Premium.' },
  PLAN_REQUIRED:       { status: 403, vi: 'Tính năng này cần gói Pass, Premium hoặc Team.', en: 'This feature needs a Pass, Premium or Team plan.' },
  PLAN_ALREADY_HIGHER: { status: 409, vi: 'Gói bạn đang dùng đã bao gồm quyền lợi này.', en: 'Your current plan already includes this.' },
  ALREADY_IN_TEAM:     { status: 409, vi: 'Bạn đang là thành viên một nhóm. Chỉ trưởng nhóm mới gia hạn được gói Team.', en: 'You’re already in a team. Only the team leader can renew Team.' },
  IN_OTHER_TEAM:       { status: 409, vi: 'Bạn đang ở một nhóm khác. Hãy rời nhóm đó trước.', en: 'You’re in another team. Leave it first.' },
  TEAM_FULL:           { status: 409, vi: 'Nhóm đã đủ 5 tài khoản (tính cả lời mời đang chờ).', en: 'The team already has 5 seats (including pending invites).' },
  ALREADY_INVITED:     { status: 409, vi: 'Email này đã có trong nhóm.', en: 'This email is already in the team.' },
  TEAM_LEADER_ONLY:    { status: 403, vi: 'Chỉ trưởng nhóm mới làm được thao tác này.', en: 'Only the team leader can do this.' },
  TEAM_INACTIVE:       { status: 409, vi: 'Gói Team của nhóm đã hết hạn. Trưởng nhóm cần gia hạn.', en: 'This team’s plan has ended. The leader needs to renew it.' },
  UNSUPPORTED_FILE:    { status: 415, vi: 'Định dạng file chưa được hỗ trợ. Hãy dùng MP3, WAV, M4A, MP4, WEBM hoặc MOV.', en: 'Unsupported file type. Use MP3, WAV, M4A, MP4, WEBM or MOV.' },
  FILE_TOO_LARGE:      { status: 413, vi: 'File vượt quá 200 MB. Hãy nén hoặc cắt ngắn file.', en: 'The file is over 200 MB. Compress or trim it.' },
  FILE_TOO_LONG:       { status: 422, vi: 'Bài nói vượt thời lượng tối đa cho phép.', en: 'The recording is longer than the maximum allowed.' },
  UPLOAD_NOT_FOUND:    { status: 409, vi: 'Chưa nhận được file. Hãy tải lên lại.', en: 'We haven’t received the file yet. Please upload again.' },
  SCRIPT_TOO_SHORT:    { status: 422, vi: 'Kịch bản cần ít nhất 40 từ để AI chấm.', en: 'Scripts need at least 40 words to be reviewed.' },
  INVALID_STATE:       { status: 409, vi: 'Thao tác không hợp lệ với trạng thái hiện tại của bài.', en: 'This action isn’t possible in the talk’s current state.' },
  PLACEMENT_DONE:      { status: 409, vi: 'Bạn đã làm bài test đầu vào rồi.', en: 'You’ve already taken the placement test.' },
  MEDIA_EXPIRED:       { status: 410, vi: 'Tệp ghi âm đã bị xóa (quá 30 ngày hoặc do bạn xóa). Báo cáo vẫn được giữ.', en: 'The recording was deleted (after 30 days or by you). The report is kept.' },
  MEDIA_IN_USE:        { status: 409, vi: 'Bài đang được AI phân tích. Hãy thử lại sau khi phân tích xong.', en: 'This talk is being analysed. Try again when it’s done.' },
  QUEUE_UNAVAILABLE:   { status: 503, vi: 'Hệ thống phân tích đang bận. Bài đã được lưu, hãy thử lại sau ít phút.', en: 'Analysis is temporarily unavailable. Your talk is saved; try again in a few minutes.' },
  PAYMENT_PROVIDER_UNAVAILABLE: { status: 503, vi: 'Phương thức thanh toán này chưa sẵn sàng. Hãy chọn phương thức khác.', en: 'This payment method isn’t available yet. Choose another one.' },
  PAYMENT_GATEWAY_ERROR: { status: 502, vi: 'Không kết nối được cổng thanh toán. Bạn chưa bị trừ tiền, hãy thử lại.', en: 'We couldn’t reach the payment gateway. You haven’t been charged; please try again.' },
  PAYMENT_NOT_PENDING: { status: 409, vi: 'Giao dịch này đã kết thúc. Hãy tạo giao dịch mới.', en: 'This payment is already closed. Start a new one.' },
  PAYMENT_EXPIRED:     { status: 410, vi: 'Giao dịch đã hết hạn. Hãy tạo giao dịch mới.', en: 'This payment has expired. Start a new one.' },
  INTERNAL:            { status: 500, vi: 'Đã có lỗi phía máy chủ. Vui lòng thử lại sau.', en: 'Something went wrong on our side. Please try again later.' },
} as const;

export type ErrorCode = keyof typeof ERRORS;
export type UiLang = 'vi' | 'en';

export class AppError extends Error {
  constructor(public readonly code: ErrorCode, public readonly details?: unknown, cause?: unknown) {
    super(code, { cause });
    this.name = 'AppError';
  }
  get status() { return ERRORS[this.code].status; }
  message_(lang: UiLang) { return ERRORS[this.code][lang]; }
}
