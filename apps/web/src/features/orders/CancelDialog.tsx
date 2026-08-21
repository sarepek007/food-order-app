import { useState } from 'react';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';

interface CancelDialogProps {
  open: boolean;
  publicNumber: number;
  busy: boolean;
  /** Ошибка валидации от сервера, разложенная по полю. */
  fieldError: string | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

const MIN_REASON_LENGTH = 3;

export function CancelDialog({
  open,
  publicNumber,
  busy,
  fieldError,
  onClose,
  onConfirm,
}: CancelDialogProps) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  const localError =
    touched && reason.trim().length < MIN_REASON_LENGTH ? 'Укажите причину отмены' : null;
  const error = localError ?? fieldError;

  function submit(): void {
    setTouched(true);
    if (reason.trim().length < MIN_REASON_LENGTH) return;
    onConfirm(reason.trim());
  }

  return (
    <Modal
      open={open}
      title="Отмена заказа"
      description={`Заказ №${publicNumber} будет отменён без возможности возврата в работу.`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Не отменять</Button>
          <Button variant="danger" loading={busy} onClick={submit}>
            Отменить заказ
          </Button>
        </>
      }
    >
      {/* Сообщение об ошибке вынесено из <label>: иначе оно попадает
          в доступное имя поля и скринридер читает его как часть подписи. */}
      <div className="flex flex-col gap-1">
        <label htmlFor="cancel-reason" className="text-sm font-medium">
          Причина отмены
        </label>
        <textarea
          id="cancel-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          onBlur={() => setTouched(true)}
          rows={3}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'cancel-reason-error' : undefined}
          placeholder="Например: клиент передумал"
          className={`rounded-md px-3 py-2 text-sm ring-1 ${error ? 'ring-danger' : 'ring-line'}`}
        />
        {error && (
          <span id="cancel-reason-error" role="alert" className="text-xs text-danger">
            {error}
          </span>
        )}
      </div>
    </Modal>
  );
}
