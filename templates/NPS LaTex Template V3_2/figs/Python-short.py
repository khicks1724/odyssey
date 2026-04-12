# This code calculates the factorial of a given number and prints it

def factorial(n):
    if n == 0:
        return 1
    else:
        return n * factorial(n-1)

number = 5
result = factorial(number)
print(f"The factorial of {number} is {result}")
