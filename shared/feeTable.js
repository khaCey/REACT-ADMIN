/**
 * Fee table - ported from Code.js
 */
export const feeTable = {
  OLD: {
    Single: {
      '2x': 4620,
      '4x': 4400,
      '8x': 3960,
    },
    Group: {
      2: { '2x': 2860, '4x': 2750, '8x': 2530 },
      3: { '2x': 2273, '4x': 2200, '8x': 2053 },
      4: { '2x': 1980, '4x': 1925, '8x': 1815 },
    },
    Pronunciation: 7700,
  },
  Neo: {
    Single: {
      '2x': 7150,
      '4x': 5720,
      '8x': 4950,
    },
    Group: {
      2: { '2x': 4675, '4x': 3960, '8x': 3575 },
      3: { '2x': 3850, '4x': 3373, '8x': 3117 },
      4: { '2x': 3438, '4x': 3080, '8x': 2888 },
    },
  },
  "Owner's Lesson": {
    1: { '2x': 9350, '4x': 7920, '8x': 7150 },
    2: { '2x': 11550, '4x': 10120, '8x': 9350 },
    3: { '2x': 13750, '4x': 12320, '8x': 11550 },
    4: { '2x': 15950, '4x': 14520, '8x': 13750 },
  },
  "Owner's Course": {
    1: { '2x': 9350, '4x': 7920, '8x': 7150 },
    2: { '2x': 11550, '4x': 10120, '8x': 9350 },
    3: { '2x': 13750, '4x': 12320, '8x': 11550 },
    4: { '2x': 15950, '4x': 14520, '8x': 13750 },
  },
};

export function calculatePrice(lessonsCount, paymentType = 'Neo', groupType = 'Single', groupSize = 2, frequency = '4x') {
  const freq = lessonsCount <= 2 ? '2x' : lessonsCount <= 4 ? '4x' : '8x';
  const payNorm = String(paymentType || '').trim();
  const ownerPayment = /owner'?s?\s*(lesson|course)/i.test(payNorm);
  if (ownerPayment) {
    const isSingle = groupType === 'Single' || groupType === 'Individual';
    const people = isSingle ? 1 : Math.min(4, Math.max(2, Number(groupSize) || 2));
    return feeTable["Owner's Lesson"][people]?.[freq] || 0;
  }
  const payment = payNorm.toUpperCase() === 'OLD' ? feeTable.OLD : feeTable.Neo;
  if (lessonsCount === 1 && payment === feeTable.Neo) {
    return feeTable["Owner's Lesson"][1]['2x'];
  }
  // "Individual" in students.Group maps to Single rates (Code.js uses same mapping)
  const isSingle = groupType === 'Single' || groupType === 'Individual';
  if (isSingle) {
    return payment.Single[freq] || 0;
  }
  const size = Math.min(4, Math.max(2, groupSize));
  return payment.Group[size]?.[freq] || 0;
}
