// Should this purchase require guardian approval?
// Fail closed: in 'over_limit' mode an unknown/unparseable total requires approval.
export function shouldRequireApproval(settings, total) {
  switch (settings.guardianMode) {
    case 'always':
      return true;
    case 'over_limit':
      if (total == null || Number.isNaN(total)) return true; // fail closed
      return total > settings.guardianLimit;
    case 'off':
    default:
      return false;
  }
}
