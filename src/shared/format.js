export function formatAmount(raw, decimals = 9, precision = 5) {
  if (
    !/^\d+$/.test(String(raw)) ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 38 ||
    !Number.isInteger(precision) ||
    precision < 0 ||
    precision > 38
  )
    return "—";
  const digits = String(raw).padStart(decimals + 1, "0");
  const whole = decimals ? digits.slice(0, -decimals) : digits;
  const fraction = decimals
    ? digits.slice(-decimals).slice(0, precision).replace(/0+$/, "")
    : "";
  if (
    BigInt(whole) === 0n &&
    BigInt(raw) > 0n &&
    !fraction &&
    decimals > precision
  ) {
    return precision ? `<0.${"0".repeat(precision - 1)}1` : "<1";
  }
  return (
    BigInt(whole).toLocaleString("en-US") + (fraction ? `.${fraction}` : "")
  );
}
