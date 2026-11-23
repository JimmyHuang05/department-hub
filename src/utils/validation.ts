import {ValidationRule, FormErrors} from'../types';

export function validateField(value: any, rules: ValidationRule[]): string | null {for (const rule of rules) {if (rule.required && (value === undefined || value === null || value ==='')) {return rule.message ||'此字段必填';}

 if (value !== undefined && value !== null && value !=='') {if (rule.min !== undefined && String(value).length < rule.min) {return rule.message ||`最少${rule.min}个字符`;}

 if (rule.max !== undefined && String(value).length > rule.max) {return rule.message ||`最多${rule.max}个字符`;}

 if (rule.pattern && !rule.pattern.test(String(value))) {return rule.message ||'格式不正确';}

 if (rule.validator) {const result = rule.validator(value);
 if (typeof result ==='string') {return result;}
 if (result === false) {return rule.message ||'验证失败';}}}}
 return null;}

export function validateForm(data: any, rules: {[key: string]: ValidationRule[]}): FormErrors {const errors: FormErrors = {};
 
 for (const [field, fieldRules] of Object.entries(rules)) {const error = validateField(data[field], fieldRules);
 if (error) {errors[field] = error;}}
 
 return errors;}
