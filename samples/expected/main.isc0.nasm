; Exemple ISCode niveau 0

bits 64
global main

section .data
msg db 'Hello'
big dt 5

section .bss
len resq 1

section .text
main:
  mov rax,1
  mov rdi,1
  mov rsi,msg
  mov rdx,6
  int 0x80
  call print

print:
    push rdx
    mov rdx, -1
.print_len:
    inc rdx
    cmp byte [rsi+rdx], 0
    jne .print_len
    mov rax, 1
    mov rdi, 1
    syscall
    pop rdx
    ret
