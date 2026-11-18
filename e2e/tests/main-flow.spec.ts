import { expect, test } from '@playwright/test';
import path from 'node:path';

/**
 * Luồng chính: đăng nhập → nhập báo giá → xác nhận → xuất Excel.
 * Yêu cầu: hệ thống đã setup (hoặc seed) với admin E2E_EMAIL / E2E_PASSWORD.
 */
const EMAIL = process.env.E2E_EMAIL ?? 'admin@example.com';
const PASSWORD = process.env.E2E_PASSWORD ?? 'Admin12345';
const SAMPLE = path.resolve(import.meta.dirname, '..', '..', 'sample');
const SHOTS = path.resolve(import.meta.dirname, '..', 'screenshots');

test('đăng nhập → nhập báo giá → xác nhận → xuất Excel', async ({ page }) => {
  await page.goto('/login');
  await page.screenshot({ path: path.join(SHOTS, '01-login.png') });
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();

  await expect(page.getByRole('heading', { name: 'Tổng quan' })).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, '02-dashboard.png') });

  await page.getByRole('link', { name: 'Nhập báo giá' }).first().click();
  await expect(page.getByRole('heading', { name: 'Nhập báo giá' })).toBeVisible();

  // Tải báo giá ARK (khách + mã hàng đều có trong dữ liệu seed)
  await page.locator('input[type="file"]').setInputFiles(path.join(SAMPLE, '111126_QM-ARK_NA-BGM.pdf'));
  const card = page.locator('.card-surface', { hasText: '111126_QM-ARK_NA-BGM.pdf' });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText('CÔNG TY TNHH ARK VIỆT NAM').first()).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, '03-quote-draft.png'), fullPage: true });

  // Số báo giá trong file mẫu có thể đã tồn tại từ lần chạy trước -> dùng số duy nhất
  const quoteNo = `E2E-${Date.now()}`;
  await card.getByLabel('Số báo giá').fill(quoteNo);

  const confirm = card.getByRole('button', { name: 'Xác nhận', exact: true });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByText('Đã lưu hóa đơn nháp')).toBeVisible();

  await page.getByRole('link', { name: 'Hóa đơn' }).first().click();
  await expect(page.getByRole('heading', { name: 'Hóa đơn' })).toBeVisible();
  const row = page.getByRole('row', { name: /ARK VIỆT NAM/ }).first();
  await expect(row).toBeVisible();
  await row.getByRole('checkbox').check();
  await page.screenshot({ path: path.join(SHOTS, '04-invoices.png') });

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Xuất Excel/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('mau_hd_export.xlsx');
  await download.saveAs(path.join(SHOTS, 'mau_hd_export.xlsx'));
  await expect(page.getByText('Đã xuất file Excel')).toBeVisible();
});

test('trang khách hàng và sản phẩm hiển thị danh mục', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Tổng quan' })).toBeVisible();

  await page.goto('/customers');
  await expect(page.getByRole('heading', { name: 'Khách hàng' })).toBeVisible();
  await expect(page.getByText('0110717304')).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, '05-customers.png') });

  await page.goto('/products');
  await expect(page.getByRole('heading', { name: 'Sản phẩm' })).toBeVisible();
  await expect(page.getByText('HD340', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, '06-products.png') });

  // Command palette
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Bảng lệnh' })).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, '07-command.png') });
});

test('chi tiết báo giá, tạo khách hàng từ báo giá, đổi mật khẩu', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Tổng quan' })).toBeVisible();

  // Lịch sử báo giá -> mở chi tiết dòng đầu tiên
  await page.goto('/quotes');
  await expect(page.getByRole('heading', { name: 'Lịch sử báo giá' })).toBeVisible();
  const firstRow = page.locator('tbody tr').first();
  await expect(firstRow).toBeVisible();
  await firstRow.click();
  await expect(page.getByRole('heading', { name: /^Báo giá / })).toBeVisible();
  await expect(page.getByText('Thông tin báo giá')).toBeVisible();
  await expect(page.getByText('Tổng cộng').first()).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, '08-quote-detail.png'), fullPage: true });

  // Nút xóa: hóa đơn đã xuất phải bị khóa, còn lại mở hộp thoại xác nhận
  const deleteBtn = page.getByRole('button', { name: 'Xóa', exact: true });
  await expect(deleteBtn).toBeVisible();
  if (await deleteBtn.isEnabled()) {
    await deleteBtn.click();
    await expect(page.getByRole('dialog', { name: 'Xóa báo giá?' })).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, '09-quote-delete.png') });
    await page.getByRole('button', { name: 'Hủy' }).click();
  } else {
    // Báo giá vừa được xuất hóa đơn -> phải khóa xóa
    await expect(deleteBtn).toHaveAttribute('title', /đã xuất/);
    await page.screenshot({ path: path.join(SHOTS, '09-quote-delete-locked.png') });
  }

  // Trang nhập báo giá: nút tạo khách hàng mới mở hộp thoại có MST điền sẵn
  await page.goto('/quotes/import');
  await page.locator('input[type="file"]').setInputFiles(path.join(SAMPLE, '111126_QM-ARK_NA-BGM.pdf'));
  const card = page.locator('.card-surface', { hasText: '111126_QM-ARK_NA-BGM.pdf' });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: 'Tạo khách hàng mới' }).click();
  const nc = page.getByRole('dialog', { name: 'Thêm khách hàng' });
  await expect(nc).toBeVisible();
  await expect(nc.getByLabel('Mã số thuế')).toHaveValue('2400573873');
  await page.screenshot({ path: path.join(SHOTS, '10-new-customer.png') });
  await nc.getByRole('button', { name: 'Hủy' }).click();

  // Menu tài khoản -> hộp thoại đổi mật khẩu
  await page.getByRole('button', { name: 'Tài khoản' }).click();
  await page.getByRole('menuitem', { name: 'Đổi mật khẩu' }).click();
  await expect(page.getByRole('dialog', { name: 'Đổi mật khẩu' })).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, '11-change-password.png') });
  await page.getByRole('button', { name: 'Hủy' }).click();
});
